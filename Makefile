# 数字货币交易API系统 Makefile

.PHONY: help start stop restart status logs clean dev test build install

# 默认目标
.DEFAULT_GOAL := help

# 颜色定义
BLUE := \033[36m
GREEN := \033[32m
YELLOW := \033[33m
RED := \033[31m
NC := \033[0m

help: ## 显示帮助信息
	@echo "$(BLUE)数字货币交易API系统$(NC)"
	@echo ""
	@echo "$(GREEN)可用命令:$(NC)"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(BLUE)%-12s$(NC) %s\n", $$1, $$2}'
	@echo ""
	@echo "$(YELLOW)示例:$(NC)"
	@echo "  make start     # 启动系统"
	@echo "  make dev       # 开发模式"
	@echo "  make logs      # 查看日志"

start: ## 启动系统
	@echo "$(GREEN)启动数字货币交易API系统...$(NC)"
	@./start.sh start

stop: ## 停止系统
	@echo "$(YELLOW)停止数字货币交易API系统...$(NC)"
	@./start.sh stop

restart: ## 重启系统
	@echo "$(BLUE)重启数字货币交易API系统...$(NC)"
	@./start.sh restart

status: ## 查看系统状态
	@./start.sh status

logs: ## 查看日志
	@./start.sh logs

clean: ## 清理系统（删除所有数据）
	@echo "$(RED)警告: 这将删除所有容器和数据!$(NC)"
	@./start.sh clean

dev: ## 开发模式启动
	@echo "$(GREEN)启动开发模式...$(NC)"
	@./start.sh dev

test: ## 运行测试
	@echo "$(BLUE)运行测试...$(NC)"
	@./start.sh test

build: ## 构建项目
	@echo "$(BLUE)构建项目...$(NC)"
	@./start.sh build

install: ## 安装依赖
	@echo "$(BLUE)安装Node.js依赖...$(NC)"
	@npm install

quick: ## 快速启动（使用quick-start.sh）
	@echo "$(GREEN)快速启动系统...$(NC)"
	@./quick-start.sh

health: ## 健康检查
	@echo "$(BLUE)检查API健康状态...$(NC)"
	@curl -s http://localhost:53000/api/v1/ping | jq . || echo "$(RED)API服务未响应$(NC)"

backup: ## 备份数据库
	@echo "$(BLUE)备份数据库...$(NC)"
	@mkdir -p backups
	@docker-compose exec postgres pg_dump -U trading_user trading > backups/backup_$(shell date +%Y%m%d_%H%M%S).sql
	@echo "$(GREEN)备份完成: backups/backup_$(shell date +%Y%m%d_%H%M%S).sql$(NC)"

restore: ## 恢复数据库（需要指定文件: make restore FILE=backup.sql）
	@if [ -z "$(FILE)" ]; then \
		echo "$(RED)请指定备份文件: make restore FILE=backup.sql$(NC)"; \
		exit 1; \
	fi
	@echo "$(YELLOW)恢复数据库: $(FILE)$(NC)"
	@docker-compose exec -T postgres psql -U trading_user trading < $(FILE)
	@echo "$(GREEN)恢复完成$(NC)"

ps: ## 查看容器状态
	@docker-compose ps

exec-api: ## 进入API容器
	@docker-compose exec api sh

exec-db: ## 进入数据库容器
	@docker-compose exec postgres psql -U trading_user trading

exec-redis: ## 进入Redis容器
	@docker-compose exec redis redis-cli

update: ## 更新依赖
	@echo "$(BLUE)更新Node.js依赖...$(NC)"
	@npm update
	@echo "$(BLUE)更新Docker镜像...$(NC)"
	@docker-compose pull

lint: ## 代码检查（如果有配置）
	@if [ -f "package.json" ] && npm list eslint > /dev/null 2>&1; then \
		echo "$(BLUE)运行代码检查...$(NC)"; \
		npm run lint; \
	else \
		echo "$(YELLOW)未配置ESLint$(NC)"; \
	fi

format: ## 代码格式化（如果有配置）
	@if [ -f "package.json" ] && npm list prettier > /dev/null 2>&1; then \
		echo "$(BLUE)格式化代码...$(NC)"; \
		npm run format; \
	else \
		echo "$(YELLOW)未配置Prettier$(NC)"; \
	fi

# 开发相关命令
dev-install: ## 安装开发依赖
	@echo "$(BLUE)安装开发依赖...$(NC)"
	@npm install --include=dev

dev-db: ## 仅启动数据库和Redis（用于开发）
	@echo "$(GREEN)启动开发数据库...$(NC)"
	@docker-compose up -d postgres redis

# 监控命令
monitor: ## 监控系统资源
	@echo "$(BLUE)系统资源监控:$(NC)"
	@docker stats --no-stream

top: ## 查看容器进程
	@docker-compose top

# 网络相关
network: ## 查看Docker网络
	@docker network ls | grep trading

ports: ## 查看端口占用
	@echo "$(BLUE)端口占用情况:$(NC)"
	@lsof -i :53000 || echo "端口 53000: 空闲"
	@lsof -i :5432 || echo "端口 5432: 空闲"  
	@lsof -i :6379 || echo "端口 6379: 空闲"