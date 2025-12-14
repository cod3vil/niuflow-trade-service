export interface User {
  id: number;
  apiKey: string;
  apiSecret: string;
  exchange: string;
  exchangeApiKey?: string;
  exchangeSecret?: string;
  permissions: string[];
  status: 'active' | 'inactive' | 'suspended';
  createdAt: Date;
}

export interface Order {
  id: number;
  userId: number;
  exchange: string;
  exchangeOrderId?: string;
  symbol: string;
  side: 'buy' | 'sell';
  type: 'limit' | 'market';
  price?: number;
  amount: number;
  filled: number;
  status: 'pending' | 'filled' | 'canceled' | 'failed';
  fee?: number;
  feeCurrency?: string;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface BalanceSnapshot {
  id: number;
  userId: number;
  exchange: string;
  balances: Record<string, string>;
  createdAt: Date;
}

export interface ApiLog {
  id: number;
  userId?: number;
  endpoint: string;
  method: string;
  statusCode: number;
  responseTime: number;
  error?: string;
  createdAt: Date;
}

export interface OrderParams {
  symbol: string;
  side: 'buy' | 'sell';
  type: 'limit' | 'market';
  amount: number;
  price?: number;
}

export interface TickerData {
  symbol: string;
  last: number;
  bid: number;
  ask: number;
  volume: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
  timestamp: number;
}

export interface OrderBookData {
  symbol: string;
  bids: [number, number][];
  asks: [number, number][];
  timestamp: number;
}

export interface KlineData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Balance {
  currency: string;
  free: number;
  used: number;
  total: number;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  timestamp: number;
}

export interface AuthenticatedRequest {
  userId: number;
  user: User;
  permissions: string[];
}

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: number;
}

export interface HealthCheckResult {
  status: 'healthy' | 'unhealthy';
  timestamp: number;
  checks: {
    database: 'ok' | 'error';
    redis: 'ok' | 'error';
    apiSuccessRate: number;
  };
  uptime: number;
}