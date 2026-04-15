"""
语义搜索记忆。

用法（在对话中说）：
  搜一下我记得什么关于颜色的偏好
  查找关于供应链的知识

或通过工具调用：
  search_memory({"query": "用户喜欢什么颜色", "limit": 5})
"""

import json
import os
import sys

import requests


MEMORY_API = os.environ.get("MEMORY_API_URL", "http://memory-service:3010")
AGENT_ID = os.environ.get("HERMES_AGENT_ID", os.environ.get("HOSTNAME", "unknown"))


def run(args):
    if isinstance(args, str):
        try:
            data = json.loads(args)
        except json.JSONDecodeError:
            data = {"query": args}
    else:
        data = dict(args)

    if "query" not in data:
        return {"error": "query is required"}

    payload = {
        "agent_id": AGENT_ID,
        "query": data["query"],
        "limit": data.get("limit", 10),
    }

    if data.get("user_id"):
        payload["user_id"] = data["user_id"]

    try:
        resp = requests.post(f"{MEMORY_API}/api/memory/search", json=payload, timeout=10)
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
        result = run(" ".join(sys.argv[1:]))
    else:
        result = run(sys.stdin.read())
    print(json.dumps(result, ensure_ascii=False, indent=2))

