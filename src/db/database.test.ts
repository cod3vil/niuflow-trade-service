import { Database } from './index';
import { DatabaseError } from '../utils/error';

// Mock pg module
jest.mock('pg', () => {
  const mockQuery = jest.fn();
  const mockConnect = jest.fn();
  const mockRelease = jest.fn();
  const mockEnd = jest.fn();
  const mockOn = jest.fn();

  const mockClient = {
    query: mockQuery,
    release: mockRelease,
  };

  const mockPool = {
    query: mockQuery,
    connect: mockConnect,
    end: mockEnd,
    on: mockOn,
  };

  return {
    Pool: jest.fn(() => mockPool),
    __mockQuery: mockQuery,
    __mockConnect: mockConnect,
    __mockRelease: mockRelease,
    __mockEnd: mockEnd,
    __mockOn: mockOn,
    __mockClient: mockClient,
    __mockPool: mockPool,
  };
});

const pg = require('pg');

describe('Database Tests', () => {
  let database: Database;

  beforeEach(() => {
    jest.clearAllMocks();
    // 重置单例实例
    (Database as any).instance = undefined;
    database = Database.getInstance();
  });

  describe('Connection Pool Management', () => {
    test('应该是单例模式', () => {
      const instance1 = Database.getInstance();
      const instance2 = Database.getInstance();
      
      expect(instance1).toBe(instance2);
    });

    test('应该正确初始化连接池', () => {
      expect(pg.Pool).toHaveBeenCalledWith(
        expect.objectContaining({
          host: expect.any(String),
          port: expect.any(Number),
          database: expect.any(String),
          user: expect.any(String),
          password: expect.any(String),
          max: expect.any(Number),
        })
      );
    });

    test('应该设置连接池事件监听器', () => {
      expect(pg.__mockOn).toHaveBeenCalledWith('error', expect.any(Function));
      expect(pg.__mockOn).toHaveBeenCalledWith('connect', expect.any(Function));
    });
  });

  describe('Query Operations', () => {
    test('成功执行查询', async () => {
      const mockResult = { rows: [{ id: 1 }], rowCount: 1 };
      pg.__mockQuery.mockResolvedValue(mockResult);

      const result = await database.query('SELECT * FROM users WHERE id = $1', [1]);

      expect(pg.__mockQuery).toHaveBeenCalledWith('SELECT * FROM users WHERE id = $1', [1]);
      expect(result).toEqual(mockResult);
    });

    test('查询失败应该抛出DatabaseError', async () => {
      const mockError = new Error('Connection failed');
      pg.__mockQuery.mockRejectedValue(mockError);

      await expect(
        database.query('SELECT * FROM users')
      ).rejects.toThrow(DatabaseError);
    });

    test('应该记录查询执行时间', async () => {
      const mockResult = { rows: [], rowCount: 0 };
      pg.__mockQuery.mockResolvedValue(mockResult);

      await database.query('SELECT 1');

      expect(pg.__mockQuery).toHaveBeenCalled();
    });
  });

  describe('Client Management', () => {
    test('成功获取客户端连接', async () => {
      pg.__mockConnect.mockResolvedValue(pg.__mockClient);

      const client = await database.getClient();

      expect(pg.__mockConnect).toHaveBeenCalled();
      expect(client).toBe(pg.__mockClient);
    });

    test('获取客户端失败应该抛出DatabaseError', async () => {
      const mockError = new Error('Connection pool exhausted');
      pg.__mockConnect.mockRejectedValue(mockError);

      await expect(database.getClient()).rejects.toThrow(DatabaseError);
    });
  });

  describe('Transaction Management', () => {
    test('成功执行事务', async () => {
      pg.__mockConnect.mockResolvedValue(pg.__mockClient);
      pg.__mockClient.query
        .mockResolvedValueOnce({ command: 'BEGIN' })
        .mockResolvedValueOnce({ command: 'COMMIT' });

      const callback = jest.fn().mockResolvedValue('success');

      const result = await database.transaction(callback);

      expect(pg.__mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(callback).toHaveBeenCalledWith(pg.__mockClient);
      expect(pg.__mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(pg.__mockRelease).toHaveBeenCalled();
      expect(result).toBe('success');
    });

    test('事务失败应该回滚', async () => {
      pg.__mockConnect.mockResolvedValue(pg.__mockClient);
      pg.__mockClient.query
        .mockResolvedValueOnce({ command: 'BEGIN' })
        .mockResolvedValueOnce({ command: 'ROLLBACK' });

      const mockError = new Error('Transaction failed');
      const callback = jest.fn().mockRejectedValue(mockError);

      await expect(database.transaction(callback)).rejects.toThrow(mockError);

      expect(pg.__mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(pg.__mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(pg.__mockRelease).toHaveBeenCalled();
    });
  });

  describe('Health Check', () => {
    test('健康检查成功', async () => {
      pg.__mockQuery.mockResolvedValue({ rows: [{ health: 1 }] });

      const isHealthy = await database.healthCheck();

      expect(pg.__mockQuery).toHaveBeenCalledWith('SELECT 1 as health');
      expect(isHealthy).toBe(true);
    });

    test('健康检查失败', async () => {
      pg.__mockQuery.mockRejectedValue(new Error('Connection failed'));

      const isHealthy = await database.healthCheck();

      expect(isHealthy).toBe(false);
    });
  });

  describe('User Operations', () => {
    test('创建用户', async () => {
      const mockUser = { id: 1, api_key: 'test_key' };
      pg.__mockQuery.mockResolvedValue({ rows: [mockUser] });

      const userData = {
        apiKey: 'test_key',
        apiSecret: 'test_secret',
        exchange: 'binance',
      };

      const result = await database.createUser(userData);

      expect(pg.__mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO users'),
        expect.arrayContaining([userData.apiKey, userData.apiSecret, userData.exchange])
      );
      expect(result).toEqual(mockUser);
    });

    test('根据API Key查询用户', async () => {
      const mockUser = { id: 1, api_key: 'test_key' };
      pg.__mockQuery.mockResolvedValue({ rows: [mockUser] });

      const result = await database.getUserByApiKey('test_key');

      expect(pg.__mockQuery).toHaveBeenCalledWith(
        'SELECT * FROM users WHERE api_key = $1 AND status = $2',
        ['test_key', 'active']
      );
      expect(result).toEqual(mockUser);
    });

    test('用户不存在时返回null', async () => {
      pg.__mockQuery.mockResolvedValue({ rows: [] });

      const result = await database.getUserByApiKey('nonexistent_key');

      expect(result).toBeNull();
    });
  });

  describe('Order Operations', () => {
    test('创建订单', async () => {
      const mockOrder = { id: 1, symbol: 'BTC/USDT' };
      pg.__mockQuery.mockResolvedValue({ rows: [mockOrder] });

      const orderData = {
        userId: 1,
        exchange: 'binance',
        symbol: 'BTC/USDT',
        side: 'buy',
        type: 'limit',
        amount: 0.1,
        price: 50000,
      };

      const result = await database.createOrder(orderData);

      expect(pg.__mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO orders'),
        expect.arrayContaining([
          orderData.userId,
          orderData.exchange,
          undefined,
          orderData.symbol,
          orderData.side,
          orderData.type,
          orderData.price,
          orderData.amount,
        ])
      );
      expect(result).toEqual(mockOrder);
    });

    test('更新订单状态', async () => {
      const mockOrder = { id: 1, status: 'filled' };
      pg.__mockQuery.mockResolvedValue({ rows: [mockOrder] });

      const result = await database.updateOrderStatus(1, 'filled', 0.1, 0.001, 'BTC');

      expect(pg.__mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE orders'),
        [1, 'filled', 0.1, 0.001, 'BTC', undefined]
      );
      expect(result).toEqual(mockOrder);
    });

    test('根据ID查询订单', async () => {
      const mockOrder = { id: 1, user_id: 1 };
      pg.__mockQuery.mockResolvedValue({ rows: [mockOrder] });

      const result = await database.getOrderById(1, 1);

      expect(pg.__mockQuery).toHaveBeenCalledWith(
        'SELECT * FROM orders WHERE id = $1 AND user_id = $2',
        [1, 1]
      );
      expect(result).toEqual(mockOrder);
    });

    test('查询用户订单列表', async () => {
      const mockOrders = [{ id: 1 }, { id: 2 }];
      pg.__mockQuery.mockResolvedValue({ rows: mockOrders });

      const result = await database.getUserOrders(1, 10, 0);

      expect(pg.__mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM orders WHERE user_id = $1'),
        [1, 10, 0]
      );
      expect(result).toEqual(mockOrders);
    });
  });

  describe('API Logging', () => {
    test('记录API调用', async () => {
      pg.__mockQuery.mockResolvedValue({ rows: [] });

      const logData = {
        userId: 1,
        endpoint: '/api/v1/orders',
        method: 'POST',
        statusCode: 200,
        responseTime: 150,
      };

      await database.logApiCall(logData);

      expect(pg.__mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO api_logs'),
        [
          logData.userId,
          logData.endpoint,
          logData.method,
          logData.statusCode,
          logData.responseTime,
          undefined,
        ]
      );
    });

    test('获取API统计信息', async () => {
      const mockStats = {
        total_requests: 100,
        avg_response_time: 200,
        errors: 5,
        success_count: 95,
      };
      pg.__mockQuery.mockResolvedValue({ rows: [mockStats] });

      const result = await database.getApiStats(3600000);

      expect(pg.__mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT')
      );
      expect(result).toEqual(mockStats);
    });
  });

  describe('Connection Cleanup', () => {
    test('正确关闭连接池', async () => {
      pg.__mockEnd.mockResolvedValue(undefined);

      await database.close();

      expect(pg.__mockEnd).toHaveBeenCalled();
    });

    test('关闭连接池失败应该抛出错误', async () => {
      const mockError = new Error('Failed to close pool');
      pg.__mockEnd.mockRejectedValue(mockError);

      await expect(database.close()).rejects.toThrow(mockError);
    });
  });
});