import os
import sys
import pymysql
import pymysql.cursors
from dotenv import dotenv_values

env_path = os.path.expanduser("~/.f5-mysql.env")
if not os.path.exists(env_path):
    print(f"Error: credentials file not found at {env_path}", file=sys.stderr)
    sys.exit(1)

cfg = dotenv_values(env_path)

conn = pymysql.connect(
    host=cfg.get("HOST", "localhost"),
    port=int(cfg.get("PORT", 3306)),
    user=cfg["USER"],
    password=cfg["PASSWORD"],
    database=cfg["DATABASE"],
    cursorclass=pymysql.cursors.DictCursor,
    ssl_disabled=True,
)

with conn:
    with conn.cursor() as cur:
        cur.execute("""
            SELECT
                p.id         AS person_id,
                p.name       AS name,
                p.email      AS email
            FROM potential_participants pp
            JOIN purchases      pu ON pu.id      = pp.purchase_id
            JOIN jobs            j  ON j.id       = pu.job_id
            JOIN persons         p  ON p.id       = j.person_id
            WHERE pp.event_id = 5674
              AND pp.showed   = 1
            ORDER BY p.name
        """)
        rows = cur.fetchall()

if not rows:
    print("No attending members found for event 5674.")
else:
    print(f"Attending members for event 5674 ({len(rows)} total):\n")
    for r in rows:
        print(f"  [{r['person_id']}] {r['name']}  <{r['email']}>")
