---
description: 
alwaysApply: true
---

# Hermes Memo Provider — ARCHIVED

## ⚠️ 当前状态：本仓库已退役（2026-04-17）

团队记忆方案已经全部切到 [**Honcho 托管**](https://app.honcho.dev)。Honcho 已被 [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) 原生集成，**不需要任何自维护代码**。

## 演进史

| 代际 | 方案 | 状态 |
|---|---|---|
| v1 | Node.js HTTP 服务 + DashVector | ❌ 退役（src/ 已删）|
| v2 | Python `mem0_provider_new.py` + Zilliz + 百炼 | ❌ 退役（实际从未稳定运行，Zilliz collection 始终为空）|
| **v3** | hermes-agent 内置 honcho 插件 → Honcho 托管 | **✅ 当前方案** |

## 给 AI 助手的当前工作原则

- **不再写任何 mem0 / DashVector / Zilliz 相关代码**——已废弃
- **不再修改本仓库**（除 README.md / CLAUDE.md 维护性更新）
- **如需 Honcho 接入或运维**：去 hermes 容器内跑 `hermes memory setup` / `hermes memory status`
- **如需写隐私规则 / 接入文档**：写到 [team wiki](https://wiki.86lux.net) `canon/system/` 下，不要写到本仓库
- **如需查 v1/v2 历史**：去 git log 看，源码已删

## 关联

- 当前 wiki：https://wiki.86lux.net
- 当前 hermes 仓库：https://github.com/NousResearch/hermes-agent
- Honcho 托管：https://app.honcho.dev
- Honcho 跟 Hermes 集成文档：https://docs.honcho.dev/v3/guides/integrations/hermes

## 归档时间表

待 Honcho 切换稳定运行 1 个月后（约 2026-05-17），本仓库将在 GitHub 上 archive 变只读。
