"""
保存一条记忆到向量数据库。

用法（在对话中说）：
  请记住：用户偏好淡紫色的产品
  记住这个事实：用户是跨境电商卖家，自有工厂

或通过工具调用：
  save_memory({"content": "用户偏好淡紫色", "type": "preference", "importance": 0.8})
"""

import json
import os
import sys

import requests


MEMORY_API = os.environ.get("MEMORY_API_URL", "http://memory-service:3010")
AGENT_ID = os.environ.get("HERMES_AGENT_ID", "").strip()
API_KEY = os.environ.get("MEMORY_SERVICE_API_KEY", "").strip()


def run(args):
    if not API_KEY:
        return {"error": "MEMORY_SERVICE_API_KEY is required"}
    if not AGENT_ID:
        return {
            "error": "HERMES_AGENT_ID is required. Do not rely on HOSTNAME in Docker because it changes after container restarts."
        }

    if isinstance(args, str):
        try:
            data = json.loads(args)
        except json.JSONDecodeError:
            data = {"content": args}
    else:
        data = dict(args)

    if "content" not in data:
        return {"error": "content is required"}

    payload = {
        "agent_id": AGENT_ID,
        "user_id": data.get("user_id", ""),
        "type": data.get("type", "fact"),
        "content": data["content"],
        "importance": data.get("importance", 0.5),
    }

    try:
        resp = requests.post(
            f"{MEMORY_API}/api/memory",
            json=payload,
            timeout=10,
            headers={"X-Memory-Api-Key": API_KEY},
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
        result = run(" ".join(sys.argv[1:]))
    else:
        result = run(sys.stdin.read())
    print(json.dumps(result, ensure_ascii=False, indent=2))

