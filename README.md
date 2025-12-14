# 数字货币交易API接口文档

## 概述

这是一个极小规模的数字货币交易接口系统，提供统一的REST API接口，支持多个数字货币交易所的市场数据查询、订单管理和账户操作。

**基础URL**: `http://localhost:53000`

**技术栈**: Fastify + PostgreSQL + Redis + ccxt + pino

## 认证机制

### HMAC-SHA256签名认证

所有私有接口都需要在请求头中包含以下认证信息：

```
X-API-Key: 您的API密钥
X-Timestamp: 请求时间戳（毫秒）
X-Signature: HMAC-SHA256签名
```

### 签名生成方法

```javascript
const message = timestamp + method + path + body;
const signature = crypto.createHmac('sha256', apiSecret).update(message).digest('hex');
```

**注意**: 时间戳必须在5分钟窗口内，否则请求将被拒绝。

## 限流规则

- **全局限流**: 100请求/分钟/IP
- **用户限流**: 50请求/分钟/用户
- **交易端点**: 10请求/分钟/用户
- **市场数据**: 200请求/分钟/用户

## 公开接口（无需认证）

### 1. 健康检查

```
GET /api/v1/ping
```

**响应示例**:
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "timestamp": 1640995200000,
    "checks": {
      "database": "ok",
      "cache": "ok",
      "exchanges": {
        "binance": true,
        "okx": true
      }
    }
  }
}
```

### 2. 服务器时间

```
GET /api/v1/time
```

**响应示例**:
```json
{
  "success": true,
  "data": {
    "serverTime": 1640995200000,
    "iso": "2021-12-31T16:00:00.000Z"
  },
  "timestamp": 1640995200000
}
```

### 3. 支持的交易所列表

```
GET /api/v1/exchanges
```

**响应示例**:
```json
{
  "success": true,
  "data": ["binance", "okx"],
  "timestamp": 1640995200000
}
```

### 4. 获取行情数据

```
GET /api/v1/market/ticker/{symbol}?exchange=binance
```

**参数**:
- `symbol`: 交易对符号 (如: BTC/USDT)
- `exchange`: 交易所名称 (可选，默认: binance)

**响应示例**:
```json
{
  "success": true,
  "data": {
    "symbol": "BTC/USDT",
    "last": 50000.00,
    "bid": 49999.50,
    "ask": 50000.50,
    "volume": 1234.56,
    "change": 500.00,
    "changePercent": 1.01,
    "high": 51000.00,
    "low": 49000.00,
    "timestamp": 1640995200000
  },
  "timestamp": 1640995200000
}
```

### 5. 获取订单簿深度

```
GET /api/v1/market/depth/{symbol}?exchange=binance&limit=20
```

**参数**:
- `symbol`: 交易对符号
- `exchange`: 交易所名称 (可选，默认: binance)
- `limit`: 深度档位数量 (可选，默认: 20)

**响应示例**:
```json
{
  "success": true,
  "data": {
    "symbol": "BTC/USDT",
    "bids": [
      [49999.50, 1.5],
      [49999.00, 2.0]
    ],
    "asks": [
      [50000.50, 1.2],
      [50001.00, 1.8]
    ],
    "timestamp": 1640995200000
  },
  "timestamp": 1640995200000
}
```

### 6. 获取K线数据

```
GET /api/v1/market/klines/{symbol}?exchange=binance&interval=1h&limit=100
```

**参数**:
- `symbol`: 交易对符号
- `exchange`: 交易所名称 (可选，默认: binance)
- `interval`: 时间间隔 (可选，默认: 1h)
- `limit`: 数据条数 (可选，默认: 100)

**响应示例**:
```json
{
  "success": true,
  "data": [
    {
      "timestamp": 1640995200000,
      "open": 50000.00,
      "high": 51000.00,
      "low": 49500.00,
      "close": 50500.00,
      "volume": 100.5
    }
  ],
  "timestamp": 1640995200000
}
```

## 私有接口（需要认证）

### 7. 创建订单

```
POST /api/v1/trade/order
```

**请求体**:
```json
{
  "exchange": "binance",
  "symbol": "BTC/USDT",
  "side": "buy",
  "type": "limit",
  "amount": 0.1,
  "price": 50000.00
}
```

**响应示例**:
```json
{
  "success": true,
  "data": {
    "id": 123,
    "userId": 456,
    "exchange": "binance",
    "exchangeOrderId": "exchange_123",
    "symbol": "BTC/USDT",
    "side": "buy",
    "type": "limit",
    "price": 50000.00,
    "amount": 0.1,
    "filled": 0.0,
    "status": "pending",
    "createdAt": "2021-12-31T16:00:00.000Z"
  },
  "timestamp": 1640995200000
}
```

### 8. 取消订单

```
DELETE /api/v1/trade/order/{orderId}
```

**响应示例**:
```json
{
  "success": true,
  "data": {
    "id": 123,
    "status": "canceled",
    "updatedAt": "2021-12-31T16:05:00.000Z"
  },
  "timestamp": 1640995200000
}
```

### 9. 查询订单

```
GET /api/v1/trade/order/{orderId}
```

**响应示例**:
```json
{
  "success": true,
  "data": {
    "id": 123,
    "userId": 456,
    "exchange": "binance",
    "exchangeOrderId": "exchange_123",
    "symbol": "BTC/USDT",
    "side": "buy",
    "type": "limit",
    "price": 50000.00,
    "amount": 0.1,
    "filled": 0.05,
    "status": "partially_filled",
    "fee": 0.001,
    "feeCurrency": "BTC",
    "createdAt": "2021-12-31T16:00:00.000Z",
    "updatedAt": "2021-12-31T16:03:00.000Z"
  },
  "timestamp": 1640995200000
}
```

### 10. 查询订单列表

```
GET /api/v1/trade/orders?exchange=binance&symbol=BTC/USDT&status=filled&limit=50&offset=0
```

**查询参数**:
- `exchange`: 交易所名称 (可选)
- `symbol`: 交易对符号 (可选)
- `side`: 订单方向 (可选: buy/sell)
- `status`: 订单状态 (可选: pending/filled/canceled/failed)
- `limit`: 每页数量 (可选，默认: 50，最大: 100)
- `offset`: 偏移量 (可选，默认: 0)

**响应示例**:
```json
{
  "success": true,
  "data": {
    "orders": [
      {
        "id": 123,
        "symbol": "BTC/USDT",
        "side": "buy",
        "status": "filled",
        "createdAt": "2021-12-31T16:00:00.000Z"
      }
    ],
    "total": 150,
    "hasMore": true
  },
  "timestamp": 1640995200000
}
```

### 11. 查询余额

```
GET /api/v1/account/balance?exchange=binance
```

**参数**:
- `exchange`: 交易所名称 (可选，默认: binance)

**响应示例**:
```json
{
  "success": true,
  "data": [
    {
      "currency": "BTC",
      "free": 1.0,
      "used": 0.5,
      "total": 1.5
    },
    {
      "currency": "USDT",
      "free": 8000.0,
      "used": 2000.0,
      "total": 10000.0
    }
  ],
  "timestamp": 1640995200000
}
```

### 12. 查询账户信息

```
GET /api/v1/account/info
```

**响应示例**:
```json
{
  "success": true,
  "data": {
    "userId": 456,
    "permissions": ["read", "trade"]
  },
  "timestamp": 1640995200000
}
```

## 错误响应格式

所有错误响应都遵循统一格式：

```json
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_BALANCE",
    "message": "余额不足",
    "details": {
      "required": "100.00",
      "available": "50.00",
      "currency": "USDT"
    }
  },
  "timestamp": 1640995200000
}
```

## 常见错误码

- `AUTHENTICATION_ERROR`: 认证失败
- `AUTHORIZATION_ERROR`: 权限不足
- `VALIDATION_ERROR`: 参数验证失败
- `RATE_LIMIT_EXCEEDED`: 请求频率超限
- `INSUFFICIENT_BALANCE`: 余额不足
- `EXCHANGE_ERROR`: 交易所错误
- `NOT_FOUND`: 资源未找到
- `INTERNAL_ERROR`: 服务器内部错误

## 部署说明

### 环境变量配置

复制 `.env.example` 到 `.env` 并配置相应参数：

```bash
# 数据库配置
DB_PASSWORD=your_strong_password_here

# Redis配置  
REDIS_PASSWORD=your_redis_password

# 应用配置
API_PORT=53000
LOG_LEVEL=info

# 安全配置
ENCRYPTION_KEY=your_encryption_key_here
```

### Docker部署

```bash
# 启动服务
docker-compose up -d

# 查看日志
docker-compose logs -f api

# 停止服务
docker-compose down
```

### 本地开发

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 运行测试
npm test

# 构建生产版本
npm run build
npm start
```

## 技术特性

- **高性能**: 基于Fastify框架，支持高并发请求
- **缓存优化**: Redis缓存市场数据，减少交易所API调用
- **安全认证**: HMAC-SHA256签名验证，防止重放攻击
- **限流保护**: 多层限流机制，防止API滥用
- **错误处理**: 完善的错误处理和重试机制
- **日志监控**: 结构化JSON日志，便于监控和调试
- **容器化**: 支持Docker部署，便于扩展和维护

## 项目结构

```
├── src/
│   ├── config/           # 配置管理
│   ├── db/              # 数据库层
│   ├── middleware/      # 中间件
│   ├── routes/          # 路由定义
│   ├── services/        # 业务服务
│   ├── types/           # TypeScript类型
│   ├── utils/           # 工具函数
│   └── app.ts           # 应用入口
├── docker-compose.yml   # Docker编排
├── Dockerfile          # Docker镜像
└── README.md           # 项目文档
```

## 开发规范

- 使用TypeScript进行类型安全开发
- 遵循单元测试和属性测试相结合的测试策略
- 使用Pino进行结构化日志记录
- 采用HMAC-SHA256进行API签名认证
- 实现多层限流和缓存优化

## 许可证

MIT License