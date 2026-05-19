import os
import sys
from dotenv import dotenv_values
import mysql.connector

env_path = os.path.expanduser("~/.f5-mysql.env")
if not os.path.exists(env_path):
    print(f"Error: credentials file not found at {env_path}", file=sys.stderr)
    sys.exit(1)

cfg = dotenv_values(env_path)

conn = mysql.connector.connect(
    host=cfg.get("DB_HOST", "localhost"),
    port=int(cfg.get("DB_PORT", 3306)),
    user=cfg["DB_USER"],
    password=cfg["DB_PASSWORD"],
    database=cfg["DB_NAME"],
)

cursor = conn.cursor(dictionary=True)

cursor.execute("""
    SELECT m.id, m.name, m.email
    FROM event_attendees ea
    JOIN members m ON m.id = ea.member_id
    WHERE ea.event_id = 5674
      AND ea.status = 'attending'
    ORDER BY m.name
""")

rows = cursor.fetchall()
cursor.close()
conn.close()

if not rows:
    print("No attending members found for event 5674.")
else:
    print(f"Attending members for event 5674 ({len(rows)} total):\n")
    for r in rows:
        print(f"  {r['name']} <{r['email']}>")
