import { Pool, PoolClient, QueryResult } from 'pg';
import { configManager } from '../config';
import { Logger } from '../utils/logger';
import { DatabaseError } from '../utils/error';

export class Database {
  private static instance: Database;
  private pool: Pool;
  private logger: Logger;

  private constructor() {
    this.logger = new Logger({ component: 'Database' });
    this.pool = new Pool({
      host: configManager.database.host,
      port: configManager.database.port,
      database: configManager.database.database,
      user: configManager.database.username,
      password: configManager.database.password,
      max: configManager.database.maxConnections,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    this.pool.on('error', (err) => {
      this.logger.error('PostgreSQL pool error', err);
    });

    this.pool.on('connect', () => {
      this.logger.debug('New PostgreSQL connection established');
    });
  }

  public static getInstance(): Database {
    if (!Database.instance) {
      Database.instance = new Database();
    }
    return Database.instance;
  }

  public async query<T extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
    const start = Date.now();
    try {
      const result = await this.pool.query<T>(text, params);
      const duration = Date.now() - start;
      
      this.logger.debug('Database query executed', {
        query: text,
        duration,
        rowCount: result.rowCount,
      });
      
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      this.logger.error('Database query failed', error as Error, {
        query: text,
        params,
        duration,
      });
      throw new DatabaseError(`Database query failed: ${(error as Error).message}`, {
        query: text,
        params,
      });
    }
  }

  public async getClient(): Promise<PoolClient> {
    try {
      return await this.pool.connect();
    } catch (error) {
      this.logger.error('Failed to get database client', error as Error);
      throw new DatabaseError(`Failed to get database client: ${(error as Error).message}`);
    }
  }

  public async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.getClient();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error('Transaction failed, rolled back', error as Error);
      throw error;
    } finally {
      client.release();
    }
  }

  public async healthCheck(): Promise<boolean> {
    try {
      const result = await this.query('SELECT 1 as health');
      return result.rows.length > 0 && result.rows[0].health === 1;
    } catch (error) {
      this.logger.error('Database health check failed', error as Error);
      return false;
    }
  }

  public async close(): Promise<void> {
    try {
      await this.pool.end();
      this.logger.info('Database connection pool closed');
    } catch (error) {
      this.logger.error('Error closing database connection pool', error as Error);
      throw error;
    }
  }

  // 用户相关操作
  public async createUser(userData: {
    apiKey: string;
    apiSecret: string;
    exchange: string;
    exchangeApiKey?: string;
    exchangeSecret?: string;
    permissions?: string[];
  }) {
    const query = `
      INSERT INTO users (api_key, api_secret, exchange, exchange_api_key, exchange_secret, permissions)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    const values = [
      userData.apiKey,
      userData.apiSecret,
      userData.exchange,
      userData.exchangeApiKey,
      userData.exchangeSecret,
      JSON.stringify(userData.permissions || ['read']),
    ];
    
    const result = await this.query(query, values);
    return result.rows[0];
  }

  public async getUserByApiKey(apiKey: string) {
    const query = 'SELECT * FROM users WHERE api_key = $1 AND status = $2';
    const result = await this.query(query, [apiKey, 'active']);
    return result.rows[0] || null;
  }

  // 订单相关操作
  public async createOrder(orderData: {
    userId: number;
    exchange: string;
    exchangeOrderId?: string;
    symbol: string;
    side: string;
    type: string;
    price?: number;
    amount: number;
  }) {
    const query = `
      INSERT INTO orders (user_id, exchange, exchange_order_id, symbol, side, type, price, amount)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;
    const values = [
      orderData.userId,
      orderData.exchange,
      orderData.exchangeOrderId,
      orderData.symbol,
      orderData.side,
      orderData.type,
      orderData.price,
      orderData.amount,
    ];
    
    const result = await this.query(query, values);
    return result.rows[0];
  }

  public async updateOrderStatus(orderId: number, status: string, filled?: number, fee?: number, feeCurrency?: string, error?: string) {
    const query = `
      UPDATE orders 
      SET status = $2, filled = COALESCE($3, filled), fee = COALESCE($4, fee), 
          fee_currency = COALESCE($5, fee_currency), error = COALESCE($6, error), updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `;
    const values = [orderId, status, filled, fee, feeCurrency, error];
    
    const result = await this.query(query, values);
    return result.rows[0];
  }

  public async getOrderById(orderId: number, userId?: number) {
    let query = 'SELECT * FROM orders WHERE id = $1';
    const values = [orderId];
    
    if (userId) {
      query += ' AND user_id = $2';
      values.push(userId);
    }
    
    const result = await this.query(query, values);
    return result.rows[0] || null;
  }

  public async getUserOrders(userId: number, limit: number = 50, offset: number = 0) {
    const query = `
      SELECT * FROM orders 
      WHERE user_id = $1 
      ORDER BY created_at DESC 
      LIMIT $2 OFFSET $3
    `;
    const result = await this.query(query, [userId, limit, offset]);
    return result.rows;
  }

  // 余额快照操作
  public async createBalanceSnapshot(userId: number, exchange: string, balances: Record<string, string>) {
    const query = `
      INSERT INTO balance_snapshots (user_id, exchange, balances)
      VALUES ($1, $2, $3)
      RETURNING *
    `;
    const values = [userId, exchange, JSON.stringify(balances)];
    
    const result = await this.query(query, values);
    return result.rows[0];
  }

  // API日志操作
  public async logApiCall(logData: {
    userId?: number;
    endpoint: string;
    method: string;
    statusCode: number;
    responseTime: number;
    error?: string;
  }) {
    const query = `
      INSERT INTO api_logs (user_id, endpoint, method, status_code, response_time, error)
      VALUES ($1, $2, $3, $4, $5, $6)
    `;
    const values = [
      logData.userId,
      logData.endpoint,
      logData.method,
      logData.statusCode,
      logData.responseTime,
      logData.error,
    ];
    
    await this.query(query, values);
  }

  public async getApiStats(timeWindow: number = 3600000) { // 默认1小时
    const query = `
      SELECT 
        COUNT(*) as total_requests,
        AVG(response_time) as avg_response_time,
        COUNT(CASE WHEN status_code >= 500 THEN 1 END) as errors,
        COUNT(CASE WHEN status_code < 400 THEN 1 END) as success_count
      FROM api_logs 
      WHERE created_at > NOW() - INTERVAL '${timeWindow} milliseconds'
    `;
    
    const result = await this.query(query);
    return result.rows[0];
  }
}

export const database = Database.getInstance();