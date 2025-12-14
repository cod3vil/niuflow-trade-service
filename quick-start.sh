#!/bin/bash

# 数字货币交易API系统快速启动脚本
# 一键启动，无需参数

echo "🚀 启动数字货币交易API系统..."

# 检查 Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Docker 未安装，请先安装 Docker"
    exit 1
fi

# 检查 Docker Compose
if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose 未安装，请先安装 Docker Compose"
    exit 1
fi

# 创建 .env 文件（如果不存在）
if [[ ! -f ".env" ]]; then
    if [[ -f ".env.example" ]]; then
        echo "📝 创建 .env 配置文件..."
        cp .env.example .env
    else
        echo "❌ .env.example 文件不存在"
        exit 1
    fi
fi

# 启动服务
echo "🐳 启动 Docker 容器..."
docker-compose up -d

# 等待服务启动
echo "⏳ 等待服务启动..."
sleep 15

# 健康检查
echo "🔍 检查服务状态..."
if curl -s http://localhost:53000/api/v1/ping > /dev/null 2>&1; then
    echo "✅ 系统启动成功！"
    echo ""
    echo "📡 API地址: http://localhost:53000"
    echo "🏥 健康检查: http://localhost:53000/api/v1/ping"
    echo "📊 容器状态: docker-compose ps"
    echo "📋 查看日志: docker-compose logs -f"
    echo "🛑 停止系统: docker-compose down"
else
    echo "❌ 系统启动失败，请检查日志:"
    docker-compose logs
fi