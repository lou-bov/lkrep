"""Pure logic: read PhantomBuster exports, normalise LinkedIn URLs, decide per lead.

Nothing in this module touches the database or the network, so it can be unit tested.
"""
import csv
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from urllib.parse import unquote, urlparse

# --- LinkedIn URLs ---------------------------------------------------------

_PROFILE_RE = re.compile(r"/in/([^/?#]+)", re.I)
_SALES_RE = re.compile(r"/sales/(?:lead|people)/([^,/?#]+)", re.I)
_POST_ID_RE = re.compile(r"(?:activity|ugcPost|share)(?::|-|%3A)(\d{15,20})", re.I)


def profile_key(url):
    """Return a canonical key for a LinkedIn profile URL.

    '/in/<slug>' URLs become 'in:<slug>' (lowercased, url-decoded).
    Internal member ids (ACoAA..., /in/ACwAA... or Sales Navigator links) become
    'urn:<id>' - they can NOT be matched against the vanity URL stored in the ERP.
    """
    if not url:
        return None
    url = url.strip()
    m = _SALES_RE.search(url)
    if m:
        return "urn:" + m.group(1)
    m = _PROFILE_RE.search(url)
    if not m:
        return None
    slug = unquote(m.group(1)).strip().rstrip("/")
    if re.fullmatch(r"AC[ow]AA[\w-]+", slug):
        return "urn:" + slug
    return "in:" + slug.lower()


def is_vanity_key(key):
    return bool(key) and key.startswith("in:")


def erp_url_variants(key):
    """All spellings of a vanity profile URL we expect to find in persons.person_linkedin_url."""
    slug = key[3:]
    out = []
    for scheme in ("https://", "http://", ""):
        for host in ("www.linkedin.com", "linkedin.com", "dk.linkedin.com", "se.linkedin.com"):
            base = f"{scheme}{host}/in/{slug}"
            out += [base, base + "/"]
    return out


def post_key(url):
    """Canonical id of a LinkedIn post (the activity/ugcPost/share number), or the cleaned URL."""
    if not url:
        return ""
    m = _POST_ID_RE.search(url)
    if m:
        return m.group(1)
    p = urlparse(url.strip())
    return (p.netloc + p.path).rstrip("/").lower()


# --- PhantomBuster exports -------------------------------------------------

# PhantomBuster column names differ between phantoms and versions.
_ALIASES = {
    "profile_url": ["profileUrl", "profileLink", "linkedinProfileUrl", "url"],
    "full_name": ["fullName", "name"],
    "first_name": ["firstName"],
    "last_name": ["lastName"],
    "headline": ["occupation", "headline", "title", "job"],
    "post_url": ["postUrl", "query", "inputUrl", "postLink"],
    "reaction": ["reactionType", "reaction"],
    "comment": ["comment", "commentText", "commentContent"],
}


def _pick(row, field_name):
    for col in _ALIASES[field_name]:
        v = row.get(col)
        if v not in (None, ""):
            return v.strip()
    return ""


@dataclass
class Engager:
    key: str
    profile_url: str
    full_name: str
    first_name: str
    last_name: str
    headline: str
    engagements: list = field(default_factory=list)  # (post_key, kind)

    @property
    def post_keys(self):
        return sorted({p for p, _ in self.engagements})


def _sniff_delimiter(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        head = f.readline()
    return ";" if head.count(";") > head.count(",") else ","


def read_exports(paths, default_post_url=""):
    """Read one or more PhantomBuster CSV exports (likers, commenters, followers).

    Returns {profile_key: Engager}, deduplicated across files and posts.
    """
    engagers = {}
    for path in paths:
        with open(path, encoding="utf-8-sig", newline="") as f:
            for row in csv.DictReader(f, delimiter=_sniff_delimiter(path)):
                url = _pick(row, "profile_url")
                key = profile_key(url)
                if not key:
                    continue
                full = _pick(row, "full_name")
                first, last = _pick(row, "first_name"), _pick(row, "last_name")
                if full and not (first and last):
                    parts = full.split()
                    first, last = parts[0], " ".join(parts[1:])
                comment = _pick(row, "comment")
                kind = "comment" if comment else (_pick(row, "reaction").lower() or "follow/like")
                post = post_key(_pick(row, "post_url") or default_post_url)
                e = engagers.get(key)
                if e is None:
                    e = engagers[key] = Engager(key, url, full or f"{first} {last}".strip(),
                                                first, last, _pick(row, "headline"))
                e.engagements.append((post, kind))
    return engagers


def read_posts_registry(path):
    """posts.csv: post_url;source   (source = F5_DK | F5_SE | BI_DK | BI_SE | director:<person_id>)."""
    out = {}
    if not path:
        return out
    with open(path, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f, delimiter=_sniff_delimiter(path)):
            if row.get("post_url"):
                out[post_key(row["post_url"])] = (row.get("source") or "").strip()
    return out


# --- Decision --------------------------------------------------------------

CREATE, REVIEW, SKIP = "CREATE_OPP", "REVIEW", "SKIP"


@dataclass
class ErpFacts:
    """Everything the ERP tells us about one matched lead (all duplicate person_ids combined)."""
    person_ids: list
    never_contact: bool = False
    icp_segments: list = field(default_factory=list)   # [(segment_tag_id, tag_name, product_id)]
    open_opp_ids: list = field(default_factory=list)
    active_member: bool = False
    last_contact: datetime = None


def decide(facts, rules, now=None):
    """Return (decision, reason) for a matched lead. `rules` is the [rules] config table."""
    now = now or datetime.now()
    if facts.never_contact:
        return SKIP, "never contact"
    if facts.open_opp_ids:
        return SKIP, "open opportunity " + ",".join(map(str, facts.open_opp_ids[:3]))
    if rules.get("exclude_active_members", True) and facts.active_member:
        return SKIP, "active member"
    days = int(rules.get("recent_contact_days", 60))
    if facts.last_contact and facts.last_contact >= now - timedelta(days=days):
        return SKIP, f"contacted {facts.last_contact:%Y-%m-%d} (< {days} days)"
    if not facts.icp_segments:
        if rules.get("non_icp_action", "review") == "skip":
            return SKIP, "not in an ICP segment"
        return REVIEW, "not in an ICP segment - check if close to ICP"
    return CREATE, "ICP, no open opp, no recent contact"
