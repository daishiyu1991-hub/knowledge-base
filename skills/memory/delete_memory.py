"""
删除一条记忆（只能删自己的，其他 Agent 的记忆无法删除）。

用法：
  delete_memory("记忆ID")
"""

import json
import os
import sys

import requests


MEMORY_API = os.environ.get("MEMORY_API_URL", "http://memory-service:3010")
AGENT_ID = os.environ.get("HERMES_AGENT_ID", os.environ.get("HOSTNAME", "unknown"))


def run(args):
    if isinstance(args, str):
        mem_id = args.strip()
    else:
        mem_id = str(args)

    if not mem_id:
        return {"error": "memory id is required"}

    try:
        resp = requests.delete(
            f"{MEMORY_API}/api/memory/{mem_id}", params={"agent_id": AGENT_ID}, timeout=10
        )
        resp.raise_for_status()
        return resp.json()
    except requests.exceptions.JSONDecodeError:
        return {
            "error": f"Server returned non-JSON (HTTP {resp.status_code}): {resp.text[:200]}"
        }
    except Exception as e:
        return {"error": str(e)}


if __name__ == "__main__":
    if len(sys.argv) > 1:
        result = run(sys.argv[1])
    else:
        result = run(sys.stdin.read())
    print(json.dumps(result, ensure_ascii=False, indent=2))

