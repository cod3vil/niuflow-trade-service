-- 用户表
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    api_key VARCHAR(64) UNIQUE NOT NULL,
    api_secret VARCHAR(128) NOT NULL, -- 加密存储
    exchange VARCHAR(20) NOT NULL, -- binance/okx等
    exchange_api_key TEXT, -- 用户的交易所Key（加密）
    exchange_secret TEXT, -- 用户的交易所Secret（加密）
    permissions JSONB DEFAULT '["read"]', -- 权限：read/trade/withdraw
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_users_api_key ON users(api_key);

-- 订单表
CREATE TABLE orders (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    exchange VARCHAR(20) NOT NULL,
    exchange_order_id VARCHAR(100), -- 交易所返回的订单ID
    symbol VARCHAR(20) NOT NULL,
    side VARCHAR(10) NOT NULL, -- buy/sell
    type VARCHAR(20) NOT NULL, -- limit/market
    price DECIMAL(20, 8),
    amount DECIMAL(20, 8) NOT NULL,
    filled DECIMAL(20, 8) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'pending', -- pending/filled/canceled/failed
    fee DECIMAL(20, 8),
    fee_currency VARCHAR(10),
    error TEXT, -- 错误信息
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created_at ON orders(created_at DESC);

-- 余额快照表（可选，用于对账）
CREATE TABLE balance_snapshots (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    exchange VARCHAR(20) NOT NULL,
    balances JSONB NOT NULL, -- {"BTC": "1.5", "USDT": "10000"}
    created_at TIMESTAMP DEFAULT NOW()
);

-- API调用日志表（简化监控）
CREATE TABLE api_logs (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER,
    endpoint VARCHAR(100) NOT NULL,
    method VARCHAR(10) NOT NULL,
    status_code INTEGER,
    response_time INTEGER, -- 毫秒
    error TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_api_logs_created_at ON api_logs(created_at DESC);