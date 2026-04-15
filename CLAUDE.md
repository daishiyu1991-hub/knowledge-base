# Hermes Memory Service

## 项目简介
Hermes Agent 向量记忆中间件。5 个 Hermes Agent（admin/jingwen/guohua/linjun/yiming）运行在阿里云 ECS (8.129.13.96)，通过此服务获得语义搜索记忆能力。

## 架构
```
Hermes Agent (Python Skills) → HTTP API → memory-service (Fastify/Node.js)
                                              → DashVector (向量存储)
                                              → DashScope text-embedding-v3 (embedding, 1024维)
                                              → SQLite (元数据备份)
```

## 技术栈
- Fastify 5 + TypeScript (Node.js 22)
- DashVector REST API（阿里云托管向量搜索）
- DashScope API（text-embedding-v3，1024 维）
- better-sqlite3（本地元数据备份）
- Docker 部署

## API 端点
| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/memory` | POST | 保存记忆 |
| `/api/memory/search` | POST | 语义搜索 |
| `/api/memory/:id` | DELETE | 删除记忆（需 agent_id 校验） |
| `/api/memory` | GET | 列出最近记忆（支持 user_id 过滤） |
| `/api/memory/health` | GET | 健康检查 |

## 关键设计
- **隔离**: 单 Collection `hermes_memory`，agent_id metadata filter 隔离，非 post-search 过滤
- **安全**: 删除操作校验 agent_id，403 防跨 Agent 删除
- **降级**: DashVector 不可用时服务返回错误，不崩溃
- **缓存**: embedding 结果内存缓存，相同文本不重复调用

## 环境变量
```env
DASHVECTOR_API_KEY=       # DashVector API Key
DASHVECTOR_ENDPOINT=      # DashVector Cluster Endpoint
DASHSCOPE_API_KEY=        # DashScope API Key (embedding)
PORT=3010                 # 服务端口
HOST=0.0.0.0              # 监听地址
DB_PATH=./data/memories.db # SQLite 路径
```

## 部署
```bash
# 宿主机构建并启动
cd /opt/memory-service
npm install && npx tsc
docker compose up -d --build

# 或用部署脚本
bash deploy.sh
```

## Hermes Agent 对接
见 `hermes-memory-setup-guide.md`，包含 4 个 Python Skill 脚本：
- save_memory.py — 保存记忆
- search_memory.py — 语义搜索
- list_memory.py — 列出记忆
- delete_memory.py — 删除记忆

## 仓库
https://github.com/daishiyu1991-hub/knowledge-base

## 待办
- [ ] 主人在阿里云开通 DashVector + DashScope，获取 API Key
- [ ] 填写 .env 文件
- [ ] 部署到 ECS 服务器
- [ ] 配置 Hermes Agent Skills
- [ ] 端到端测试验证
