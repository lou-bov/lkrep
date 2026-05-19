import os
import subprocess
import sys

# 1. pymysql installed?
try:
    import pymysql
    import pymysql.cursors
except ImportError:
    print("Error: pymysql not found. Run:  pip install pymysql", file=sys.stderr)
    sys.exit(1)

# 2. python-dotenv installed?
try:
    from dotenv import dotenv_values
except ImportError:
    print("Error: python-dotenv not found. Run:  pip install python-dotenv", file=sys.stderr)
    sys.exit(1)

# 3. Credentials file exists?
_env_path = os.path.expanduser("~/.f5-mysql.env")
if not os.path.exists(_env_path):
    print(f"Error: credentials file not found at {_env_path}", file=sys.stderr)
    print("Create it with:", file=sys.stderr)
    print("  HOST=10.231.22.121", file=sys.stderr)
    print("  PORT=3306", file=sys.stderr)
    print("  USER=<your-username>", file=sys.stderr)
    print("  PASSWORD=<your-password>", file=sys.stderr)
    print("  DATABASE=f5_erp", file=sys.stderr)
    print("(ask Max for your username/password)", file=sys.stderr)
    sys.exit(1)

# 4. Cloudflare WARP running?
def _warp_running() -> bool:
    if sys.platform == "win32":
        try:
            out = subprocess.check_output(
                ["tasklist", "/FI", "IMAGENAME eq Cloudflare WARP.exe"],
                stderr=subprocess.DEVNULL,
                text=True,
            )
            return "Cloudflare WARP.exe" in out
        except Exception:
            return False
    else:
        try:
            out = subprocess.check_output(
                ["pgrep", "-x", "warp-svc"],
                stderr=subprocess.DEVNULL,
            )
            return bool(out.strip())
        except Exception:
            return False

if not _warp_running():
    print("Error: Cloudflare WARP is not running. Start WARP before connecting to the database.", file=sys.stderr)
    sys.exit(1)

cfg = dotenv_values(_env_path)

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
