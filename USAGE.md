# 数字货币交易API系统使用指南

## 🚀 快速开始

### 1. 系统要求

- **Docker** 和 **Docker Compose**（必需）
- **Node.js 18+**（仅开发模式需要）
- **操作系统**：macOS、Linux、Windows

### 2. 一键启动

**最简单的方式**：
```bash
# macOS/Linux
./quick-start.sh

# Windows
start.bat
```

这将自动：
- 检查系统依赖
- 创建配置文件
- 启动所有服务
- 进行健康检查

### 3. 完整脚本功能

使用 `start.sh`（macOS/Linux）或 `start.bat`（Windows）获得更多控制：

```bash
# 查看所有选项
./start.sh help

# 启动系统
./start.sh start

# 查看系统状态
./start.sh status

# 查看实时日志
./start.sh logs

# 开发模式（仅启动数据库，本地运行API）
./start.sh dev

# 运行测试
./start.sh test

# 停止系统
./start.sh stop

# 重启系统
./start.sh restart

# 清理所有数据（谨慎使用）
./start.sh clean
```

## 📋 系统组件

启动后的服务包括：

| 服务 | 端口 | 描述 |
|------|------|------|
| API服务 | 53000 | 主要的REST API接口 |
| PostgreSQL | 5432 | 数据库服务 |
| Redis | 6379 | 缓存服务 |

## 🔧 配置说明

### 环境变量文件 (.env)

首次运行时会自动从 `.env.example` 创建 `.env` 文件，主要配置项：

```bash
# 数据库配置
DB_PASSWORD=your_strong_password_here    # 必须修改
REDIS_PASSWORD=your_redis_password       # 建议修改

# 应用配置
API_PORT=53000                          # API端口
LOG_LEVEL=info                          # 日志级别

# 安全配置
ENCRYPTION_KEY=your_encryption_key_here  # 数据加密密钥
```

**重要**：请务必修改默认密码和密钥！

### 交易所API配置（可选）

如需连接真实交易所，在 `.env` 中添加：

```bash
# Binance
BINANCE_API_KEY=your_binance_api_key
BINANCE_SECRET=your_binance_secret
BINANCE_SANDBOX=true                     # 测试环境

# OKX
OKX_API_KEY=your_okx_api_key
OKX_SECRET=your_okx_secret
OKX_PASSPHRASE=your_okx_passphrase
OKX_SANDBOX=true                         # 测试环境
```

## 🧪 测试API

### 健康检查
```bash
curl http://localhost:53000/api/v1/ping
```

### 获取服务器时间
```bash
curl http://localhost:53000/api/v1/time
```

### 获取支持的交易所
```bash
curl http://localhost:53000/api/v1/exchanges
```

### 获取行情数据
```bash
curl "http://localhost:53000/api/v1/market/ticker/BTC/USDT?exchange=binance"
```

## 🔐 API认证

私有接口需要HMAC-SHA256签名认证：

### 1. 创建用户（需要直接操作数据库）

```sql
INSERT INTO users (api_key, api_secret, exchange, permissions) 
VALUES ('your_api_key', 'your_api_secret', 'binance', '["read", "trade"]');
```

### 2. 生成签名

```javascript
const crypto = require('crypto');

const timestamp = Date.now();
const method = 'POST';
const path = '/api/v1/trade/order';
const body = JSON.stringify({
  symbol: 'BTC/USDT',
  side: 'buy',
  type: 'limit',
  amount: 0.1,
  price: 50000
});

const message = timestamp + method + path + body;
const signature = crypto.createHmac('sha256', 'your_api_secret')
  .update(message)
  .digest('hex');
```

### 3. 发送请求

```bash
curl -X POST http://localhost:53000/api/v1/trade/order \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your_api_key" \
  -H "X-Timestamp: 1640995200000" \
  -H "X-Signature: generated_signature" \
  -d '{"symbol":"BTC/USDT","side":"buy","type":"limit","amount":0.1,"price":50000}'
```

## 🛠️ 开发模式

开发模式只启动数据库和Redis，API服务在本地运行：

```bash
# 启动开发模式
./start.sh dev

# 或者手动启动
docker-compose up -d postgres redis
npm install
npm run dev
```

优势：
- 代码热重载
- 更快的调试
- 直接查看控制台输出

## 📊 监控和日志

### 查看容器状态
```bash
./start.sh status
# 或
docker-compose ps
```

### 查看日志
```bash
# 所有服务日志
./start.sh logs

# 特定服务日志
docker-compose logs -f api
docker-compose logs -f postgres
docker-compose logs -f redis
```

### 健康检查端点
```bash
curl http://localhost:53000/api/v1/ping
```

返回系统健康状态，包括数据库和缓存连接状态。

## 🔧 故障排除

### 常见问题

**1. 端口被占用**
```bash
# 查看端口占用
lsof -i :53000
lsof -i :5432
lsof -i :6379

# 停止占用进程
kill -9 <PID>
```

**2. Docker权限问题（Linux）**
```bash
# 将用户添加到docker组
sudo usermod -aG docker $USER
# 重新登录或重启
```

**3. 数据库连接失败**
```bash
# 检查数据库容器状态
docker-compose logs postgres

# 重启数据库
docker-compose restart postgres
```

**4. Redis连接失败**
```bash
# 检查Redis容器状态
docker-compose logs redis

# 重启Redis
docker-compose restart redis
```

### 完全重置系统

如果遇到严重问题，可以完全重置：

```bash
# 停止并删除所有容器和数据
./start.sh clean

# 重新启动
./start.sh start
```

**警告**：这将删除所有数据！

## 📈 性能优化

### 1. 缓存配置

Redis缓存策略已优化：
- 行情数据：5秒TTL
- 深度数据：3秒TTL
- 用户余额：30秒TTL
- 用户信息：5分钟TTL

### 2. 数据库优化

- 使用连接池（默认10个连接）
- 关键字段已建立索引
- 支持读写分离（需要配置）

### 3. 限流配置

默认限流设置：
- 全局：100请求/分钟/IP
- 用户：50请求/分钟/用户
- 交易：10请求/分钟/用户

可在 `.env` 中调整：
```bash
RATE_LIMIT_WINDOW=60000  # 时间窗口（毫秒）
RATE_LIMIT_MAX=100       # 最大请求数
```

## 🚀 生产部署建议

### 1. 安全配置

- 修改所有默认密码
- 使用强加密密钥
- 启用HTTPS（需要配置反向代理）
- 定期更新依赖

### 2. 监控配置

- 配置日志收集
- 设置健康检查监控
- 配置告警通知

### 3. 备份策略

```bash
# 数据库备份
docker-compose exec postgres pg_dump -U trading_user trading > backup.sql

# 恢复数据库
docker-compose exec -T postgres psql -U trading_user trading < backup.sql
```

### 4. 扩展部署

- 使用Docker Swarm或Kubernetes
- 配置负载均衡
- 数据库读写分离
- Redis集群

## 📞 支持

如有问题，请检查：
1. 系统日志：`./start.sh logs`
2. 容器状态：`./start.sh status`
3. 健康检查：`curl http://localhost:53000/api/v1/ping`

更多技术细节请参考 `README.md` 中的API文档。