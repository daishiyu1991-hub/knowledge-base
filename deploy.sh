#!/bin/bash
# 部署 Memory Service 到 ECS
# 前置条件：已配置 .env 文件

set -e

echo "=== Memory Service 部署 ==="

# 1. 安装依赖 + 编译
echo "[1/3] 安装依赖 + 编译..."
npm install
npx tsc

# 2. 创建 Docker 网络（如不存在）
docker network create hermes-net 2>/dev/null || true

# 3. 构建并启动
echo "[2/3] 构建 Docker 镜像..."
docker compose build

echo "[3/3] 启动服务..."
docker compose up -d

echo ""
echo "=== 部署完成 ==="
echo "健康检查: curl http://localhost:3010/api/memory/health"
echo ""
echo "下一步：配置 Hermes Agent 的 MCP 连接"
echo "  在用户 YAML 中添加 memory MCP server 配置"
