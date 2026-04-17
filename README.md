# Hermes Memo Provider — ARCHIVED

> ⚠️ **本仓库已退役（2026-04-17）**
>
> 团队记忆方案已经从「mem0 + Zilliz + 自维护 provider」全部切到 [**Honcho 托管**](https://app.honcho.dev)。Honcho v3 已被 [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) 原生集成，**不再需要任何自维护的 provider 代码**。

## 演进史

| 代际 | 方案 | 状态 |
|---|---|---|
| v1 | Node.js Fastify HTTP 服务（端口 3010）+ DashVector + SQLite | ❌ 退役（src/ 已删除）|
| v2 | Python `mem0_provider_new.py` 进程内调 mem0 SDK + Zilliz Cloud + 百炼 | ❌ 退役（实际从未稳定运行，Zilliz collection 始终为空）|
| **v3** | hermes-agent 内置 honcho 插件 → Honcho 托管（dual-peer reasoning + Dreaming Agent）| **✅ 当前方案** |

## 怎么接 Honcho（v3 流程）

```bash
# 容器内部一条命令完成
docker exec hermes-<user> hermes memory setup
# 选 honcho，输入 https://api.honcho.dev 作为 base URL，传入 HONCHO_API_KEY

# 验证
docker exec hermes-<user> hermes memory status
# 应该看到 Provider: honcho, Status: active ✓
```

完整 onboarding / 隐私 / 运维详见 [team wiki](https://wiki.86lux.net)：
- `system/Hermes Agent 日常使用指南`
- `system/隐私规则/HERMES_HONCHO_RETRIEVAL_GUARDRAILS`
- `system/Docs-as-Code 发布架构`
- `entities/Honcho`

## 本仓库剩余内容

| 文件 | 用途 |
|---|---|
| `README.md` | 本说明 |
| `CLAUDE.md` | Claude Code 项目上下文（标注已退役）|
| `hermes-memory-setup-guide.md` | 历史文档，记录 v1 → v2 演进。v3 接入看上面 wiki 链接 |
| `.env.example` | 历史 v2 配置示例，已无意义 |
| `.gitignore` | git 配置 |

## 隐私规则文档（已迁出）

下面 3 份文档曾作为 mem0 时代的隐私铁律，**已迁移到 wiki-vault**：

- `HERMES_RUNTIME_PRIVACY_POLICY.md` → `wiki-vault/canon/system/隐私规则/`
- `HERMES_MEM0_RETRIEVAL_GUARDRAILS.md` → 替换为 `HERMES_HONCHO_RETRIEVAL_GUARDRAILS.md`
- `TEAMOS_PRIVACY_OPERATING_RULES.md` → `wiki-vault/canon/system/隐私规则/`

## 仓库归档计划

待 Honcho 切换稳定运行 1 个月后（约 2026-05-17），本仓库将在 GitHub 上归档（Settings → Archive this repository），变只读状态。
