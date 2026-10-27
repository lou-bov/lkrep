"""LinkedIn engagement -> ERP lead qualification.

  python run.py qualify --config config.toml [--export likers.csv ...] [--posts posts.csv]
  python run.py directors [--out directors.csv]

`qualify` never writes to the CRM: it produces a CSV of CREATE_OPP / REVIEW / SKIP rows.
"""
import argparse
import csv
import os
import sys
import tomllib
from datetime import datetime

from engagement import CREATE, REVIEW, SKIP, ErpFacts, decide, is_vanity_key, \
    read_exports, read_posts_registry
from erp import Erp, connect
from phantombuster import download_result

ORDER = {CREATE: 0, REVIEW: 1, SKIP: 2}
COLUMNS = ["decision", "reason", "match_method", "person_id", "name", "erp_title",
           "erp_company", "country", "linkedin_url", "headline", "icp_segment",
           "suggested_product", "suggested_owner", "post_sources", "engagement",
           "last_contact"]


def write_csv(path, rows, columns):
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=columns, delimiter=";", extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


def cmd_directors(args):
    erp = Erp(connect())
    rows = erp.directors()
    write_csv(args.out, rows, ["person_id", "person_firstname", "person_lastname",
                               "person_linkedin_url", "product_app_type", "products"])
    missing = sum(1 for r in rows if not r["person_linkedin_url"])
    print(f"Written {args.out}: {len(rows)} directors ({missing} without LinkedIn URL)")


def cmd_qualify(args):
    with open(args.config, "rb") as f:
        cfg = tomllib.load(f)
    rules = cfg.get("rules", {})
    match_cfg = cfg.get("matching", {})

    exports = list(args.export or [])
    for agent in cfg.get("phantombuster", {}).get("agents", []):
        exports.append(download_result(agent["id"], args.download_dir,
                                       agent.get("result_name", "result")))
    if not exports:
        sys.exit("No exports: pass --export files or configure [phantombuster] agents")

    engagers = read_exports(exports, default_post_url=args.post_url or "")
    posts = read_posts_registry(args.posts)
    ignore = {k.lower() for k in cfg.get("ignore_profiles", [])}
    engagers = {k: e for k, e in engagers.items() if k.lower() not in ignore}
    print(f"{len(engagers)} unique people across {len(exports)} export(s)")

    erp = Erp(connect())

    # 1. Match: LinkedIn URL first, then (optionally) name.
    matches = {}  # key -> (person_ids, method)
    by_url = erp.match_by_url([k for k in engagers if is_vanity_key(k)])
    for key, e in engagers.items():
        if key in by_url:
            matches[key] = (by_url[key], "linkedin_url")
        elif match_cfg.get("name_fallback", True) and e.first_name and e.last_name:
            matches[key] = erp.match_by_name(e.first_name, e.last_name, e.headline,
                                             set(match_cfg.get("countries", ["DK", "SE", "GL", ""])))
        else:
            matches[key] = ([], "not found in ERP")

    # 2. Facts for all matched persons in bulk.
    all_ids = sorted({p for ids, _ in matches.values() for p in ids})
    info = erp.facts(all_ids, rules.get("contact_log_types", ["sales"])) if all_ids else {}

    # 3. Decide + suggest product/owner.
    director_cache, out = {}, []
    for key, e in engagers.items():
        ids, method = matches[key]
        sources = sorted({posts.get(p, args.source or "") for p in e.post_keys} - {""})
        row = {"linkedin_url": e.profile_url, "name": e.full_name, "headline": e.headline,
               "post_sources": ", ".join(sources),
               "engagement": "; ".join(f"{k} on {p}" for p, k in e.engagements)}
        if not ids:
            decision = SKIP if rules.get("unmatched_action", "review") == "skip" else REVIEW
            row.update(decision=decision, reason=method, match_method="none")
            out.append(row)
            continue

        facts: ErpFacts = Erp.combine(info, ids)
        decision, reason = decide(facts, rules)
        if method == "name only" and decision == CREATE:
            decision, reason = REVIEW, reason + " (matched on name only - verify)"
        primary = info[ids[0]]
        row.update(
            decision=decision, reason=reason, match_method=method,
            person_id=",".join(map(str, ids)),
            name=f"{primary.get('person_firstname', '')} {primary.get('person_lastname', '')}".strip(),
            erp_title=primary.get("mp_title") or "", erp_company=primary.get("mp_company_name") or "",
            country=primary.get("person_country") or "",
            icp_segment=", ".join(s[1] for s in facts.icp_segments),
            last_contact=f"{facts.last_contact:%Y-%m-%d}" if facts.last_contact else "",
        )

        # Product: the director's group for director posts, else the ICP segment's product.
        product_ids = []
        for s in sources:
            if s.startswith("director:"):
                pid = int(s.split(":", 1)[1])
                if pid not in director_cache:
                    director_cache[pid] = erp.director_products(pid)
                product_ids += [d["product_id"] for d in director_cache[pid]]
        product_ids += [s[2] for s in facts.icp_segments if s[2]]
        row["_product_ids"] = list(dict.fromkeys(product_ids))
        out.append(row)

    products = erp.products({p for r in out for p in r.get("_product_ids", [])})
    for r in out:
        ps = [products[p] for p in r.pop("_product_ids", []) if p in products]
        r["suggested_product"] = " | ".join(p["product_name"] for p in ps)
        r["suggested_owner"] = next((p["owner"] for p in ps if p["owner"]), "")

    out.sort(key=lambda r: (ORDER[r["decision"]], r["name"]))
    write_csv(args.out, out, COLUMNS)
    counts = {d: sum(1 for r in out if r["decision"] == d) for d in ORDER}
    print(f"Written {args.out}: " + ", ".join(f"{v} {k}" for k, v in counts.items()))


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    stamp = datetime.now().strftime("%Y%m%d_%H%M")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    q = sub.add_parser("qualify", help="match PhantomBuster engagers against the ERP")
    q.add_argument("--config", default=os.path.join(here, "config.toml"))
    q.add_argument("--export", action="append", help="PhantomBuster CSV (repeatable)")
    q.add_argument("--posts", help="posts.csv mapping post_url -> source")
    q.add_argument("--post-url", help="post URL to use when the export has no postUrl column")
    q.add_argument("--source", help="source for posts not in posts.csv, e.g. F5_DK or director:123")
    q.add_argument("--download-dir", default="phantombuster_downloads")
    q.add_argument("--out", default=f"engagement_leads_{stamp}.csv")
    q.set_defaults(func=cmd_qualify)

    d = sub.add_parser("directors", help="export Network Directors / Rectors with LinkedIn URLs")
    d.add_argument("--out", default="directors.csv")
    d.set_defaults(func=cmd_directors)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
