"""
列出最近的记忆，可选按 user_id 过滤。

用法：
  list_memory()                    — 列出最近 50 条
  list_memory({"user_id": "xxx"})  — 按用户过滤
  list_memory({"limit": 20})       — 限制条数
"""

import json
import os

import requests


MEMORY_API = os.environ.get("MEMORY_API_URL", "http://memory-service:3010")
AGENT_ID = os.environ.get("HERMES_AGENT_ID", os.environ.get("HOSTNAME", "unknown"))


def run(args=""):
    if args and isinstance(args, str):
        try:
            data = json.loads(args)
        except json.JSONDecodeError:
            data = {}
    elif isinstance(args, dict):
        data = args
    else:
        data = {}

    params = {"agent_id": AGENT_ID, "limit": data.get("limit", 50)}
    if data.get("user_id"):
        params["user_id"] = data["user_id"]

    try:
        resp = requests.get(f"{MEMORY_API}/api/memory", params=params, timeout=10)
        resp.raise_for_status()
        return resp.json()
    except requests.exceptions.JSONDecodeError:
        return {
            "error": f"Server returned non-JSON (HTTP {resp.status_code}): {resp.text[:200]}"
        }
    except Exception as e:
        return {"error": str(e)}


if __name__ == "__main__":
    print(json.dumps(run(), ensure_ascii=False, indent=2))

