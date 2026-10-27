"""Read-only lookups against the f5_erp replica (needs Cloudflare WARP + ~/.f5-mysql.env)."""
import os
import sys
from collections import defaultdict

import pymysql
import pymysql.cursors

from engagement import ErpFacts, erp_url_variants, profile_key

ENV_PATH = os.path.expanduser("~/.f5-mysql.env")


def _load_env(path):
    cfg = {}
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line and "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                cfg[k.strip()] = v.strip()
    return cfg


def connect():
    if not os.path.exists(ENV_PATH):
        sys.exit(f"Error: credentials file not found at {ENV_PATH}")
    cfg = _load_env(ENV_PATH)
    return pymysql.connect(
        host=cfg.get("HOST", "localhost"),
        port=int(cfg.get("PORT", 3306)),
        user=cfg["USER"],
        password=cfg["PASSWORD"],
        database=cfg["DATABASE"],
        cursorclass=pymysql.cursors.DictCursor,
        connect_timeout=10,
        ssl_disabled=True,
    )


def _chunks(items, n):
    items = list(items)
    for i in range(0, len(items), n):
        yield items[i:i + n]


def _in(values):
    return ",".join(["%s"] * len(values))


class Erp:
    def __init__(self, conn):
        self.conn = conn

    def _q(self, sql, params=()):
        with self.conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchall()

    # --- matching ----------------------------------------------------------

    def match_by_url(self, keys):
        """{profile_key: [person_id, ...]} for vanity keys found in persons.person_linkedin_url(_backup)."""
        found = defaultdict(set)
        for chunk in _chunks(keys, 100):
            variants = [v for k in chunk for v in erp_url_variants(k)]
            rows = self._q(
                f"""SELECT person_id, person_linkedin_url, person_linkedin_url_backup
                    FROM persons
                    WHERE person_linkedin_url IN ({_in(variants)})
                       OR person_linkedin_url_backup IN ({_in(variants)})""",
                variants + variants,
            )
            for r in rows:
                for col in ("person_linkedin_url", "person_linkedin_url_backup"):
                    k = profile_key(r[col])
                    if k in chunk:
                        found[k].add(r["person_id"])
        return {k: sorted(v) for k, v in found.items()}

    def match_by_name(self, first, last, headline, countries):
        """Fallback when the URL is unknown. Returns (person_ids, method) or ([], reason)."""
        rows = self._q(
            """SELECT p.person_id, p.person_country, mp.mp_company_name
               FROM persons p
               LEFT JOIN mini_profile mp ON mp.person_id = p.person_id
               WHERE p.person_firstname = %s AND p.person_lastname = %s
               LIMIT 50""",
            (first, last),
        )
        rows = [r for r in rows if (r["person_country"] or "") in countries]
        if not rows:
            return [], "not found in ERP"
        hl = (headline or "").lower()
        by_company = [r for r in rows if r["mp_company_name"] and r["mp_company_name"].lower() in hl]
        if len(by_company) == 1:
            return [by_company[0]["person_id"]], "name+company"
        if len(rows) == 1:
            return [rows[0]["person_id"]], "name only"
        return [], f"{len(rows)} persons share this name"

    # --- facts -------------------------------------------------------------

    def facts(self, person_ids, contact_log_types):
        """{person_id: row-dict} with everything decide() needs, fetched in bulk."""
        info = {pid: {"open_opps": [], "segments": [], "active": False, "contacts": []}
                for pid in person_ids}
        for ids in _chunks(person_ids, 500):
            ph = _in(ids)
            for r in self._q(
                f"""SELECT p.person_id, p.person_firstname, p.person_lastname, p.person_country,
                           p.person_never_contact, p.person_linkedin_url,
                           mp.mp_title, mp.mp_company_name
                    FROM persons p LEFT JOIN mini_profile mp ON mp.person_id = p.person_id
                    WHERE p.person_id IN ({ph})""", ids):
                info[r["person_id"]].update(r)
            for r in self._q(
                f"""SELECT lt.person_id, st.segment_tag_id, st.tag_name, st.product_id
                    FROM lead_tags lt
                    JOIN segment_tags st ON st.segment_tag_id = lt.segment_tag_id
                    WHERE lt.person_id IN ({ph}) AND lt.deleted_at IS NULL
                      AND st.status = 'active' AND st.deleted_at IS NULL""", ids):
                info[r["person_id"]]["segments"].append(
                    (r["segment_tag_id"], r["tag_name"], r["product_id"]))
            for r in self._q(
                f"""SELECT j.person_id, o.opportunity_id
                    FROM opportunities o JOIN jobs j ON j.job_id = o.job_id
                    WHERE j.person_id IN ({ph}) AND o.opportunity_status = 'open'""", ids):
                info[r["person_id"]]["open_opps"].append(r["opportunity_id"])
            for r in self._q(
                f"""SELECT DISTINCT j.person_id
                    FROM purchases pu JOIN jobs j ON j.job_id = pu.job_id
                    WHERE j.person_id IN ({ph})
                      AND pu.purchase_status = 'Normal' AND pu.purchase_stop > NOW()""", ids):
                info[r["person_id"]]["active"] = True

            # Last contact: sales notes, completed calls, opportunity actions, opp created/closed.
            contact_sql = [
                (f"""SELECT person_id, MAX(person_log_creation_time) AS t FROM person_logs
                     WHERE person_id IN ({ph}) AND user_id > 0
                       AND person_log_type IN ({_in(contact_log_types)})
                     GROUP BY person_id""", ids + list(contact_log_types)),
                (f"""SELECT person_id, MAX(planned_call_completed_timestamp) AS t FROM planned_calls
                     WHERE person_id IN ({ph}) GROUP BY person_id""", ids),
                (f"""SELECT j.person_id, MAX(oa.opportunity_action_due_time) AS t
                     FROM opportunity_actions oa
                     JOIN opportunities o ON o.opportunity_id = oa.opportunity_id
                     JOIN jobs j ON j.job_id = o.job_id
                     WHERE j.person_id IN ({ph}) AND oa.opportunity_action_due_time <= NOW()
                     GROUP BY j.person_id""", ids),
                (f"""SELECT j.person_id,
                            GREATEST(COALESCE(MAX(o.opportunity_creation_time), '1970-01-01'),
                                     COALESCE(MAX(o.opportunity_closed_timestamp), '1970-01-01')) AS t
                     FROM opportunities o JOIN jobs j ON j.job_id = o.job_id
                     WHERE j.person_id IN ({ph}) GROUP BY j.person_id""", ids),
            ]
            for sql, params in contact_sql:
                for r in self._q(sql, params):
                    if r["t"]:
                        info[r["person_id"]]["contacts"].append(r["t"])
        return info

    @staticmethod
    def combine(info, person_ids):
        """Merge duplicate ERP persons of one LinkedIn profile into one ErpFacts."""
        rows = [info[p] for p in person_ids]
        contacts = [t for r in rows for t in r["contacts"]]
        return ErpFacts(
            person_ids=list(person_ids),
            never_contact=any(r.get("person_never_contact") for r in rows),
            icp_segments=[s for r in rows for s in r["segments"]],
            open_opp_ids=[o for r in rows for o in r["open_opps"]],
            active_member=any(r["active"] for r in rows),
            last_contact=max(contacts) if contacts else None,
        )

    # --- targeting ---------------------------------------------------------

    def director_products(self, person_id):
        return self._q(
            """SELECT pr.product_id, pr.product_name, pt.product_app_type
               FROM directors_to_products dtp
               JOIN jobs j ON j.job_id = dtp.job_id
               JOIN products pr ON pr.product_id = dtp.product_id
               JOIN product_types pt ON pt.product_type_id = pr.product_type_id
               WHERE j.person_id = %s AND pr.product_deactivated IS NULL""", (person_id,))

    def products(self, product_ids):
        if not product_ids:
            return {}
        ids = list(product_ids)
        rows = self._q(
            f"""SELECT pr.product_id, pr.product_name,
                       (SELECT u.display_name FROM pipelines pip
                        JOIN users u ON u.user_id = pip.user_id
                        WHERE pip.product_id = pr.product_id AND u.user_deactivated IS NULL
                        LIMIT 1) AS owner
                FROM products pr WHERE pr.product_id IN ({_in(ids)})""", ids)
        return {r["product_id"]: r for r in rows}

    def directors(self):
        """Network Directors / Rectors on active products, with their LinkedIn URL."""
        return self._q(
            """SELECT p.person_id, p.person_firstname, p.person_lastname, p.person_linkedin_url,
                      pt.product_app_type,
                      GROUP_CONCAT(DISTINCT pr.product_name ORDER BY pr.product_name SEPARATOR ' | ')
                        AS products
               FROM directors_to_products dtp
               JOIN jobs j ON j.job_id = dtp.job_id
               JOIN persons p ON p.person_id = j.person_id
               JOIN products pr ON pr.product_id = dtp.product_id
               JOIN product_types pt ON pt.product_type_id = pr.product_type_id
               WHERE pr.product_deactivated IS NULL
               GROUP BY p.person_id, pt.product_app_type
               ORDER BY pt.product_app_type, p.person_lastname
               LIMIT 2000""")
