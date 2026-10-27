# LinkedIn engagement → CRM opportunities

Finds people who react to or comment on LinkedIn posts from the **F5 DK, F5 SE, BI DK and BI SE pages** and from **Rectors / Network Directors**. It looks them up in the ERP and lists who should get a new opportunity.

```
post URLs ──► PhantomBuster ──► CSV of engagers ──► run.py qualify ──► engagement_leads_*.csv
(Sheet)       (likers/commenters)                    (ERP read-only)     CREATE_OPP / REVIEW / SKIP
```

**Version 1 never writes to the CRM.** The output is a list to review. Creating opportunities automatically comes once the CRM write path (API or import) is agreed.

## Setup

```bash
pip install -r requirements.txt
cp config.example.toml config.toml        # adjust rules
```

- Needs `~/.f5-mysql.env` (same file as the f5-mysql skill) and **Cloudflare WARP** connected.
- Optional: `PHANTOMBUSTER_API_KEY` to download results straight from PhantomBuster.

## PhantomBuster

| Phantom | Input | Used for |
|---|---|---|
| **LinkedIn Activity Extractor** | company pages + director profiles | finding new post URLs (full automation) |
| **LinkedIn Post Likers / Commenters export** | Google Sheet of post URLs | the people who engaged |
| LinkedIn Company Followers Collector | company page (admin account) | new followers (LinkedIn only shows recent ones) |

Point the likers/commenters phantoms at a Google Sheet column of post URLs and schedule them. With manual mode, a person pastes a post URL into the sheet. With full automation, the Activity Extractor fills the sheet.

To get the director profile URLs for the Activity Extractor:

```bash
python run.py directors --out directors.csv   # from directors_to_products
```

## Running

```bash
# from downloaded CSVs
python run.py qualify --export likers.csv --export commenters.csv --posts posts.csv

# or from the PhantomBuster agents listed in config.toml
python run.py qualify --posts posts.csv
```

`posts.csv` (see `posts.example.csv`) tells the script where each post came from: `F5_DK`, `F5_SE`, `BI_DK`, `BI_SE` or `director:<person_id>`. For a director post, the suggested product is that director's group. For any other post, it is the product on the person's ICP segment.

## Rules (config.toml `[rules]`)

| Decision | When |
|---|---|
| SKIP | never contact · open opportunity (any product) · active member · contact within `recent_contact_days` |
| REVIEW | matched but not in an active ICP segment ("close to ICP"?) · not found in ERP · matched on name only |
| CREATE_OPP | in an active ICP segment, none of the above |

"Recent contact" is the latest of: sales notes (`person_logs`), completed planned calls, past opportunity actions, and opportunities created or closed.

## Matching

1. The LinkedIn URL from PhantomBuster is compared with `persons.person_linkedin_url` / `_backup`, ignoring case, `www`, trailing `/` and query strings.
2. Fallback: exact first + last name (DK/SE/GL), confirmed by the company name appearing in the LinkedIn headline. Name-only matches are always REVIEW.

PhantomBuster sometimes returns internal ids (`/in/ACoAA…`) instead of `/in/name` URLs. These can only be matched by name. If many rows come back like that, add a profile-scraper step.

## Tests

```bash
python -m pytest -q
```
