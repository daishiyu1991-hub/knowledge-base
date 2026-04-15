# Hermes Agent 向量记忆系统配置指南

## 这是什么

你（Hermes Agent）现在可以接入一个**向量记忆服务**，获得语义搜索能力。

**之前**：只能关键词匹配，"用户喜欢什么颜色"搜不到"偏好淡紫色"
**现在**：语义搜索，理解意思就能找到，即使措辞完全不同

---

## 架构

```
你（Hermes） → memory-service API → DashVector（向量存储）
                                 → DashScope（embedding）
```

- memory-service 跑在 **3010 端口**，和你在同一台服务器
- 你的每个记忆都会变成一个 1024 维向量存储
- 你的记忆和其他 Agent 完全隔离，互相看不到

---

## 配置步骤

### Step 1: 创建 Skills 目录

在你的数据目录下创建 skills 文件夹：

```bash
mkdir -p /opt/data/skills/memory
```

### Step 2: 安装依赖

```bash
pip install requests
# Hermes 基础镜像通常已包含 requests，如已安装可跳过
python -c "import requests" && echo "OK" || pip install requests
```

### Step 3: 创建 save_memory skill

创建文件 `/opt/data/skills/memory/save_memory.py`：

```python
"""
保存一条记忆到向量数据库。

用法（在对话中说）：
  请记住：用户偏好淡紫色的产品
  记住这个事实：用户是跨境电商卖家，自有工厂

或通过工具调用：
  save_memory({"content": "用户偏好淡紫色", "type": "preference", "importance": 0.8})
"""
import json
import requests
import sys
import os

MEMORY_API = os.environ.get("MEMORY_API_URL", "http://memory-service:3010")
AGENT_ID = os.environ.get("HERMES_AGENT_ID", os.environ.get("HOSTNAME", "unknown"))

def run(args):
    """保存记忆"""
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
        resp = requests.post(f"{MEMORY_API}/api/memory", json=payload, timeout=10)
        resp.raise_for_status()
        return resp.json()
    except requests.exceptions.JSONDecodeError:
        return {"error": f"Server returned non-JSON (HTTP {resp.status_code}): {resp.text[:200]}"}
    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    if len(sys.argv) > 1:
        result = run(" ".join(sys.argv[1:]))
    else:
        result = run(sys.stdin.read())
    print(json.dumps(result, ensure_ascii=False, indent=2))
```

### Step 4: 创建 search_memory skill

创建文件 `/opt/data/skills/memory/search_memory.py`：

```python
"""
语义搜索记忆。

用法（在对话中说）：
  搜一下我记得什么关于颜色的偏好
  查找关于供应链的知识

或通过工具调用：
  search_memory({"query": "用户喜欢什么颜色", "limit": 5})
"""
import json
import requests
import sys
import os

MEMORY_API = os.environ.get("MEMORY_API_URL", "http://memory-service:3010")
AGENT_ID = os.environ.get("HERMES_AGENT_ID", os.environ.get("HOSTNAME", "unknown"))

def run(args):
    """搜索记忆"""
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
        return {"error": f"Server returned non-JSON (HTTP {resp.status_code}): {resp.text[:200]}"}
    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    if len(sys.argv) > 1:
        result = run(" ".join(sys.argv[1:]))
    else:
        result = run(sys.stdin.read())
    print(json.dumps(result, ensure_ascii=False, indent=2))
```

### Step 5: 创建 list_memory skill

创建文件 `/opt/data/skills/memory/list_memory.py`：

```python
"""
列出最近的记忆，可选按 user_id 过滤。

用法：
  list_memory()                    — 列出最近 50 条
  list_memory({"user_id": "xxx"})  — 按用户过滤
  list_memory({"limit": 20})       — 限制条数
"""
import json
import requests
import sys
import os

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
        return {"error": f"Server returned non-JSON (HTTP {resp.status_code}): {resp.text[:200]}"}
    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    print(json.dumps(run(), ensure_ascii=False, indent=2))
```

### Step 6: 创建 delete_memory skill

创建文件 `/opt/data/skills/memory/delete_memory.py`：

```python
"""
删除一条记忆（只能删自己的，其他 Agent 的记忆无法删除）。

用法：
  delete_memory("记忆ID")
"""
import json
import requests
import sys
import os

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
            f"{MEMORY_API}/api/memory/{mem_id}",
            params={"agent_id": AGENT_ID},
            timeout=10
        )
        resp.raise_for_status()
        return resp.json()
    except requests.exceptions.JSONDecodeError:
        return {"error": f"Server returned non-JSON (HTTP {resp.status_code}): {resp.text[:200]}"}
    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    if len(sys.argv) > 1:
        result = run(sys.argv[1])
    else:
        result = run(sys.stdin.read())
    print(json.dumps(result, ensure_ascii=False, indent=2))
```

### Step 7: 更新 Hermes 配置

在你的 `config.yaml` 中更新 skills 部分：

```yaml
skills:
  external_dirs:
    - /opt/data/skills/memory
```

添加环境变量（在你的 `.env` 文件中）：

```env
MEMORY_API_URL=http://memory-service:3010
HERMES_AGENT_ID=hermes-admin
```

> **重要**：每个 Hermes 实例的 `HERMES_AGENT_ID` 必须不同！
> - admin → `hermes-admin`
> - jingwen → `hermes-jingwen`
> - guohua → `hermes-guohua`
> - linjun → `hermes-linjun`
> - yiming → `hermes-yiming`

### Step 8: 重启 Hermes

```bash
docker restart hermes-admin
# 或对应的容器名
```

---

## 使用方法

配置完成后，你可以在对话中自然地使用记忆功能：

### 保存记忆

对话中直接说：
- "请记住：用户是做跨境电商的，有自己的工厂"
- "记下来：用户偏好简约设计风格"
- "保存这个知识：深圳的供应链优势在电子和灯具"

### 搜索记忆

对话中直接说：
- "我记得什么关于用户偏好的信息？"
- "搜一下关于供应链的知识"
- "查找之前讨论过的产品信息"

### 记忆类型

| type | 用途 | 示例 |
|------|------|------|
| `fact` | 事实 | "用户在深圳" |
| `preference` | 偏好 | "喜欢淡紫色" |
| `context` | 上下文 | "当前在做睡眠灯项目" |
| `episode` | 事件 | "4月15日讨论了向量数据库选型" |
| `skill` | 技能 | "会用 Claude Code 做选品分析" |

---

## API 参考（如需直接调用）

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/memory` | POST | 保存记忆 |
| `/api/memory/search` | POST | 语义搜索 |
| `/api/memory/:id` | DELETE | 删除记忆（需 agent_id 参数） |
| `/api/memory` | GET | 列出最近记忆（支持 user_id 过滤） |
| `/api/memory/health` | GET | 健康检查 |

---

## 验证

配置完成后测试：

> **注意**：以下地址分两种情况：
> - **Docker 容器内**使用 `http://memory-service:3010`
> - **宿主机**上测试使用 `http://localhost:3010`（需端口映射）

```bash
# 1. 检查服务是否在线（宿主机测试）
curl http://localhost:3010/api/memory/health

# 2. 保存一条测试记忆
curl -X POST http://localhost:3010/api/memory \
  -H "Content-Type: application/json" \
  -d '{"agent_id":"hermes-admin","content":"这是一条测试记忆","type":"fact"}'

# 3. 搜索测试
curl -X POST http://localhost:3010/api/memory/search \
  -H "Content-Type: application/json" \
  -d '{"agent_id":"hermes-admin","query":"测试"}'

# 4. 验证隔离（应该搜不到其他 agent 的数据）
curl -X POST http://localhost:3010/api/memory/search \
  -H "Content-Type: application/json" \
  -d '{"agent_id":"hermes-jingwen","query":"测试"}'
# 应返回空结果
```

---

## 常见问题

**Q: 我的记忆会和其他 Agent 混在一起吗？**
A: 不会。每条记忆都带 `agent_id`，搜索时自动过滤。删除也校验 `agent_id`，你只能删自己的。

**Q: memory-service 挂了怎么办？**
A: 不影响正常对话，只是无法保存/搜索向量记忆。Hermes 内置的 compressor 记忆仍然工作。skill 会返回错误信息，不会崩溃。

**Q: 记忆会过期吗？**
A: 默认不会。可以手动删除不需要的记忆。

**Q: 一条记忆最大多长？**
A: 建议每条不超过 500 字。太长的内容拆分成多条效果更好。

**Q: 保存时没传 user_id，之后搜索时传了 user_id，能搜到吗？**
A: 搜不到。user_id 为空和有值是不同的记录。建议保存时也带上 user_id（如果知道的话），保持一致。
