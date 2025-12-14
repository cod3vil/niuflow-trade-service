import { database } from '../db';
import { ExchangeService } from './ExchangeService';
import { Logger } from '../utils/logger';
import { configManager } from '../config';
import { 
  ValidationError, 
  NotFoundError, 
  InsufficientBalanceError,
  ExchangeError,
  DatabaseError 
} from '../utils/error';
import { Order, OrderParams, User } from '../types';

export interface CreateOrderRequest extends OrderParams {
  userId: number;
  exchange: string;
}

export interface OrderFilter {
  userId?: number;
  exchange?: string;
  symbol?: string;
  side?: 'buy' | 'sell';
  status?: string;
  limit?: number;
  offset?: number;
}

export class OrderService {
  private static instance: OrderService;
  private logger: Logger;
  private exchangeService: ExchangeService;

  private constructor() {
    this.logger = new Logger({ component: 'OrderService' });
    this.exchangeService = ExchangeService.getInstance();
  }

  public static getInstance(): OrderService {
    if (!OrderService.instance) {
      OrderService.instance = new OrderService();
    }
    return OrderService.instance;
  }

  public async createOrder(request: CreateOrderRequest): Promise<Order> {
    this.logger.info('Creating order', {
      userId: request.userId,
      exchange: request.exchange,
      symbol: request.symbol,
      side: request.side,
      type: request.type,
      amount: request.amount,
      price: request.price,
    });

    // 验证订单参数
    this.validateOrderParams(request);

    // 获取用户信息和交易所凭据
    const user = await database.getUserByApiKey(''); // 这里需要通过userId获取用户
    if (!user) {
      throw new NotFoundError('用户不存在');
    }

    // 解密用户的交易所凭据
    const userCredentials = this.getUserExchangeCredentials(user, request.exchange);

    try {
      // 使用数据库事务确保数据一致性
      return await database.transaction(async (client) => {
        // 1. 在数据库中创建订单记录（pending状态）
        const orderData = {
          userId: request.userId,
          exchange: request.exchange,
          symbol: request.symbol,
          side: request.side,
          type: request.type,
          price: request.price,
          amount: request.amount,
        };

        const dbOrder = await database.createOrder(orderData);

        try {
          // 2. 在交易所创建订单
          const exchangeOrder = await this.exchangeService.createOrder(
            {
              symbol: request.symbol,
              side: request.side,
              type: request.type,
              amount: request.amount,
              price: request.price,
            },
            request.exchange,
            userCredentials
          );

          // 3. 更新数据库订单记录
          const updatedOrder = await database.updateOrderStatus(
            dbOrder.id,
            this.mapExchangeStatus(exchangeOrder.status),
            exchangeOrder.filled || 0,
            exchangeOrder.fee?.cost,
            exchangeOrder.fee?.currency,
            undefined
          );

          // 4. 更新交易所订单ID
          if (exchangeOrder.id) {
            await database.query(
              'UPDATE orders SET exchange_order_id = $1 WHERE id = $2',
              [exchangeOrder.id, dbOrder.id]
            );
            updatedOrder.exchange_order_id = exchangeOrder.id;
          }

          this.logger.info('Order created successfully', {
            orderId: updatedOrder.id,
            exchangeOrderId: exchangeOrder.id,
            status: updatedOrder.status,
          });

          return updatedOrder;

        } catch (exchangeError) {
          // 交易所订单创建失败，更新数据库状态
          const errorMessage = (exchangeError as Error).message;
          
          await database.updateOrderStatus(
            dbOrder.id,
            'failed',
            0,
            undefined,
            undefined,
            errorMessage
          );

          this.logger.error('Exchange order creation failed', exchangeError as Error, {
            orderId: dbOrder.id,
            exchange: request.exchange,
          });

          // 重新抛出适当的错误类型
          if (exchangeError instanceof InsufficientBalanceError) {
            throw exchangeError;
          } else {
            throw new ExchangeError(`订单创建失败: ${errorMessage}`);
          }
        }
      });

    } catch (error) {
      this.logger.error('Order creation failed', error as Error, {
        userId: request.userId,
        exchange: request.exchange,
        symbol: request.symbol,
      });
      throw error;
    }
  }

  public async cancelOrder(orderId: number, userId: number): Promise<Order> {
    this.logger.info('Canceling order', { orderId, userId });

    // 获取订单信息
    const order = await database.getOrderById(orderId, userId);
    if (!order) {
      throw new NotFoundError('订单不存在');
    }

    if (order.status !== 'pending') {
      throw new ValidationError('只能取消待处理的订单', {
        currentStatus: order.status,
      });
    }

    // 获取用户信息和交易所凭据
    const user = await this.getUserById(userId);
    const userCredentials = this.getUserExchangeCredentials(user, order.exchange);

    try {
      // 在交易所取消订单
      if (order.exchange_order_id) {
        await this.exchangeService.cancelOrder(
          order.exchange_order_id,
          order.symbol,
          order.exchange,
          userCredentials
        );
      }

      // 更新数据库状态
      const updatedOrder = await database.updateOrderStatus(
        orderId,
        'canceled',
        order.filled,
        order.fee,
        order.fee_currency,
        undefined
      );

      this.logger.info('Order canceled successfully', {
        orderId,
        exchangeOrderId: order.exchange_order_id,
      });

      return updatedOrder;

    } catch (error) {
      this.logger.error('Order cancellation failed', error as Error, {
        orderId,
        exchangeOrderId: order.exchange_order_id,
      });

      // 即使交易所取消失败，也更新本地状态为取消
      const updatedOrder = await database.updateOrderStatus(
        orderId,
        'canceled',
        order.filled,
        order.fee,
        order.fee_currency,
        `取消失败: ${(error as Error).message}`
      );

      return updatedOrder;
    }
  }

  public async getOrder(orderId: number, userId: number): Promise<Order> {
    const order = await database.getOrderById(orderId, userId);
    if (!order) {
      throw new NotFoundError('订单不存在');
    }

    // 如果订单状态是pending，尝试从交易所同步最新状态
    if (order.status === 'pending' && order.exchange_order_id) {
      try {
        const user = await this.getUserById(userId);
        const userCredentials = this.getUserExchangeCredentials(user, order.exchange);

        const exchangeOrder = await this.exchangeService.fetchOrder(
          order.exchange_order_id,
          order.symbol,
          order.exchange,
          userCredentials
        );

        // 更新订单状态
        const updatedOrder = await database.updateOrderStatus(
          orderId,
          this.mapExchangeStatus(exchangeOrder.status),
          exchangeOrder.filled || order.filled,
          exchangeOrder.fee?.cost || order.fee,
          exchangeOrder.fee?.currency || order.fee_currency,
          undefined
        );

        this.logger.debug('Order status synchronized', {
          orderId,
          oldStatus: order.status,
          newStatus: updatedOrder.status,
        });

        return updatedOrder;

      } catch (error) {
        this.logger.warn('Failed to sync order status from exchange', error as Error, {
          orderId,
          exchangeOrderId: order.exchange_order_id,
        });
        
        // 同步失败时返回数据库中的订单
        return order;
      }
    }

    return order;
  }

  public async getUserOrders(filter: OrderFilter): Promise<{
    orders: Order[];
    total: number;
    hasMore: boolean;
  }> {
    const limit = Math.min(filter.limit || 50, 100); // 最大100条
    const offset = filter.offset || 0;

    // 构建查询条件
    let whereClause = 'WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    if (filter.userId) {
      whereClause += ` AND user_id = $${paramIndex}`;
      params.push(filter.userId);
      paramIndex++;
    }

    if (filter.exchange) {
      whereClause += ` AND exchange = $${paramIndex}`;
      params.push(filter.exchange);
      paramIndex++;
    }

    if (filter.symbol) {
      whereClause += ` AND symbol = $${paramIndex}`;
      params.push(filter.symbol);
      paramIndex++;
    }

    if (filter.side) {
      whereClause += ` AND side = $${paramIndex}`;
      params.push(filter.side);
      paramIndex++;
    }

    if (filter.status) {
      whereClause += ` AND status = $${paramIndex}`;
      params.push(filter.status);
      paramIndex++;
    }

    // 查询订单列表
    const ordersQuery = `
      SELECT * FROM orders 
      ${whereClause}
      ORDER BY created_at DESC 
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    params.push(limit, offset);

    const ordersResult = await database.query(ordersQuery, params);

    // 查询总数
    const countQuery = `SELECT COUNT(*) as total FROM orders ${whereClause}`;
    const countResult = await database.query(countQuery, params.slice(0, -2)); // 移除limit和offset参数

    const total = parseInt(countResult.rows[0].total);
    const hasMore = offset + limit < total;

    return {
      orders: ordersResult.rows,
      total,
      hasMore,
    };
  }

  public async syncOrderStatus(orderId: number): Promise<Order> {
    const order = await database.getOrderById(orderId);
    if (!order) {
      throw new NotFoundError('订单不存在');
    }

    if (!order.exchange_order_id || order.status === 'filled' || order.status === 'canceled') {
      return order; // 无需同步
    }

    try {
      const user = await this.getUserById(order.user_id);
      const userCredentials = this.getUserExchangeCredentials(user, order.exchange);

      const exchangeOrder = await this.exchangeService.fetchOrder(
        order.exchange_order_id,
        order.symbol,
        order.exchange,
        userCredentials
      );

      const updatedOrder = await database.updateOrderStatus(
        orderId,
        this.mapExchangeStatus(exchangeOrder.status),
        exchangeOrder.filled || order.filled,
        exchangeOrder.fee?.cost || order.fee,
        exchangeOrder.fee?.currency || order.fee_currency,
        undefined
      );

      this.logger.info('Order status synchronized', {
        orderId,
        oldStatus: order.status,
        newStatus: updatedOrder.status,
        filled: updatedOrder.filled,
      });

      return updatedOrder;

    } catch (error) {
      this.logger.error('Order status sync failed', error as Error, {
        orderId,
        exchangeOrderId: order.exchange_order_id,
      });
      throw error;
    }
  }

  private validateOrderParams(params: CreateOrderRequest): void {
    if (!params.symbol || typeof params.symbol !== 'string') {
      throw new ValidationError('交易对符号无效');
    }

    if (!['buy', 'sell'].includes(params.side)) {
      throw new ValidationError('订单方向必须是buy或sell');
    }

    if (!['limit', 'market'].includes(params.type)) {
      throw new ValidationError('订单类型必须是limit或market');
    }

    if (!params.amount || params.amount <= 0) {
      throw new ValidationError('订单数量必须大于0');
    }

    if (params.type === 'limit' && (!params.price || params.price <= 0)) {
      throw new ValidationError('限价订单必须指定有效价格');
    }

    if (!params.exchange || typeof params.exchange !== 'string') {
      throw new ValidationError('交易所名称无效');
    }

    // 检查交易所是否支持
    const supportedExchanges = this.exchangeService.getSupportedExchanges();
    if (!supportedExchanges.includes(params.exchange)) {
      throw new ValidationError(`不支持的交易所: ${params.exchange}`);
    }
  }

  private async getUserById(userId: number): Promise<User> {
    const result = await database.query('SELECT * FROM users WHERE id = $1', [userId]);
    if (result.rows.length === 0) {
      throw new NotFoundError('用户不存在');
    }
    return result.rows[0];
  }

  private getUserExchangeCredentials(user: User, exchange: string): any {
    if (!user.exchange_api_key || !user.exchange_secret) {
      throw new ValidationError('用户未配置交易所API凭据');
    }

    // 解密用户的交易所凭据
    const credentials = {
      apiKey: configManager.decryptSensitiveData(user.exchange_api_key),
      secret: configManager.decryptSensitiveData(user.exchange_secret),
    };

    // OKX需要passphrase
    if (exchange === 'okx' && user.exchange_secret) {
      // 假设passphrase存储在exchange_secret字段的特定格式中
      // 实际实现中可能需要单独的字段
      credentials.passphrase = 'your_passphrase'; // 需要根据实际存储方式调整
    }

    return credentials;
  }

  private mapExchangeStatus(exchangeStatus: string): string {
    const statusMap: { [key: string]: string } = {
      'open': 'pending',
      'closed': 'filled',
      'canceled': 'canceled',
      'cancelled': 'canceled',
      'rejected': 'failed',
      'expired': 'failed',
    };

    return statusMap[exchangeStatus] || 'pending';
  }

  public async getOrderStatistics(userId: number, timeRange?: {
    startDate: Date;
    endDate: Date;
  }): Promise<{
    totalOrders: number;
    filledOrders: number;
    canceledOrders: number;
    failedOrders: number;
    totalVolume: number;
    totalFees: number;
  }> {
    let whereClause = 'WHERE user_id = $1';
    const params = [userId];

    if (timeRange) {
      whereClause += ' AND created_at >= $2 AND created_at <= $3';
      params.push(timeRange.startDate, timeRange.endDate);
    }

    const query = `
      SELECT 
        COUNT(*) as total_orders,
        COUNT(CASE WHEN status = 'filled' THEN 1 END) as filled_orders,
        COUNT(CASE WHEN status = 'canceled' THEN 1 END) as canceled_orders,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_orders,
        COALESCE(SUM(CASE WHEN status = 'filled' THEN filled * price END), 0) as total_volume,
        COALESCE(SUM(CASE WHEN status = 'filled' THEN fee END), 0) as total_fees
      FROM orders 
      ${whereClause}
    `;

    const result = await database.query(query, params);
    const stats = result.rows[0];

    return {
      totalOrders: parseInt(stats.total_orders),
      filledOrders: parseInt(stats.filled_orders),
      canceledOrders: parseInt(stats.canceled_orders),
      failedOrders: parseInt(stats.failed_orders),
      totalVolume: parseFloat(stats.total_volume) || 0,
      totalFees: parseFloat(stats.total_fees) || 0,
    };
  }
}

export const orderService = OrderService.getInstance();