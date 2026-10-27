"""Download the latest result CSV of PhantomBuster agents (API v2).

Needs PHANTOMBUSTER_API_KEY in the environment. Each agent's result file lives at
https://phantombuster.s3.amazonaws.com/<orgS3Folder>/<s3Folder>/<result_name>.csv
"""
import json
import os
import sys
import urllib.request

API = "https://api.phantombuster.com/api/v2"


def _get(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read()


def download_result(agent_id, out_dir, result_name="result"):
    key = os.environ.get("PHANTOMBUSTER_API_KEY")
    if not key:
        sys.exit("Error: set PHANTOMBUSTER_API_KEY to download from PhantomBuster")
    agent = json.loads(_get(f"{API}/agents/fetch?id={agent_id}",
                            {"X-Phantombuster-Key-1": key}))
    url = (f"https://phantombuster.s3.amazonaws.com/"
           f"{agent['orgS3Folder']}/{agent['s3Folder']}/{result_name}.csv")
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f"phantom_{agent_id}.csv")
    with open(path, "wb") as f:
        f.write(_get(url))
    return path
