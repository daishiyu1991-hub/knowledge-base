# Memory Service 对接 Hermes Agent

## 方案一：Hermes Skill（最稳定）

在 Hermes 的 skills 目录创建 HTTP 调用脚本：

### skill: save_memory
```python
# 文件位置: ~/.hermes/skills/save_memory/skill.py
"""保存记忆到向量数据库"""
import requests, json, sys

MEMORY_API = "http://memory-service:3010"

def run(args):
    data = json.loads(args) if isinstance(args, str) else args
    resp = requests.post(f"{MEMORY_API}/api/memory", json=data, timeout=10)
    return resp.json()
```

### skill: search_memory
```python
# 文件位置: ~/.hermes/skills/search_memory/skill.py
"""语义搜索记忆"""
import requests, json, sys

MEMORY_API = "http://memory-service:3010"

def run(args):
    data = json.loads(args) if isinstance(args, str) else args
    resp = requests.post(f"{MEMORY_API}/api/memory/search", json=data, timeout=10)
    return resp.json()
```

在用户 YAML 中配置：
```yaml
skills:
  external_dirs:
    - /opt/data/skills
```

## 方案二：MCP Server（如 Hermes 支持）

在用户 YAML 中追加：
```yaml
mcp_servers:
  memory:
    command: node
    args: ["/opt/memory-mcp/index.js"]
    env:
      MEMORY_API_URL: "http://memory-service:3010"
```

## 方案三：Honcho 兼容（如 Hermes 支持）

设置 memory.provider 指向 memory-service：
```yaml
memory:
  provider: custom
  custom:
    base_url: "http://memory-service:3010"
```

## 推荐路径

1. 先试 Skill 方案（最确定可用）
2. 如果 Hermes 版本支持 MCP，切换到 MCP
3. 两种都不行，写一个 Python wrapper 脚本
