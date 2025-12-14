import * as fc from 'fast-check';
import { CacheService } from './CacheService';
import { CacheError } from '../utils/error';

// Mock ioredis
jest.mock('ioredis', () => {
  const mockRedis = {
    get: jest.fn(),
    set: jest.fn(),
    setex: jest.fn(),
    del: jest.fn(),
    exists: jest.fn(),
    incr: jest.fn(),
    decr: jest.fn(),
    expire: jest.fn(),
    ttl: jest.fn(),
    ping: jest.fn(),
    flushall: jest.fn(),
    quit: jest.fn(),
    mget: jest.fn(),
    pipeline: jest.fn(),
    on: jest.fn(),
  };

  const mockPipeline = {
    set: jest.fn().mockReturnThis(),
    setex: jest.fn().mockReturnThis(),
    exec: jest.fn(),
  };

  mockRedis.pipeline.mockReturnValue(mockPipeline);

  return jest.fn(() => mockRedis);
});

const Redis = require('ioredis');

describe('CacheService Tests', () => {
  let cacheService: CacheService;
  let mockRedis: any;

  beforeEach(() => {
    jest.clearAllMocks();
    // 重置单例实例
    (CacheService as any).instance = undefined;
    cacheService = CacheService.getInstance();
    mockRedis = Redis.mock.results[Redis.mock.results.length - 1].value;
  });

  describe('**Feature: crypto-trading-api, Property 4: 缓存命中行为**', () => {
    test('对于任何已缓存且未过期的数据，系统应该从缓存返回数据而不调用外部API', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.oneof(
            fc.string(),
            fc.integer(),
            fc.boolean(),
            fc.record({
              price: fc.float({ min: 0, max: 100000 }),
              volume: fc.float({ min: 0, max: 1000000 }),
              timestamp: fc.integer({ min: 1000000000, max: 2000000000 }),
            })
          ),
          async (key, value) => {
            // 模拟缓存命中
            const serializedValue = typeof value === 'string' ? value : JSON.stringify(value);
            mockRedis.get.mockResolvedValue(serializedValue);

            // 从缓存获取数据
            const result = await cacheService.get(key);

            // 验证返回的数据与原始数据一致
            expect(result).toEqual(value);
            
            // 验证只调用了get方法，没有调用其他方法
            expect(mockRedis.get).toHaveBeenCalledWith(key);
            expect(mockRedis.get).toHaveBeenCalledTimes(1);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('缓存未命中时应该返回null', async () => {
      mockRedis.get.mockResolvedValue(null);

      const result = await cacheService.get('nonexistent_key');

      expect(result).toBeNull();
      expect(mockRedis.get).toHaveBeenCalledWith('nonexistent_key');
    });

    test('缓存设置和获取的往返一致性', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.oneof(
            fc.string(),
            fc.record({
              symbol: fc.string(),
              price: fc.float({ min: 0, max: 100000 }),
              volume: fc.float({ min: 0, max: 1000000 }),
            })
          ),
          fc.option(fc.integer({ min: 1, max: 3600 })),
          async (key, value, ttl) => {
            // 模拟设置缓存
            mockRedis.set.mockResolvedValue('OK');
            mockRedis.setex.mockResolvedValue('OK');

            // 设置缓存
            await cacheService.set(key, value, ttl);

            // 验证正确的方法被调用
            const serializedValue = typeof value === 'string' ? value : JSON.stringify(value);
            if (ttl) {
              expect(mockRedis.setex).toHaveBeenCalledWith(key, ttl, serializedValue);
            } else {
              expect(mockRedis.set).toHaveBeenCalledWith(key, serializedValue);
            }

            // 模拟获取缓存
            mockRedis.get.mockResolvedValue(serializedValue);
            const result = await cacheService.get(key);

            // 验证往返一致性
            expect(result).toEqual(value);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Singleton Pattern', () => {
    test('应该是单例模式', () => {
      const instance1 = CacheService.getInstance();
      const instance2 = CacheService.getInstance();
      
      expect(instance1).toBe(instance2);
    });
  });

  describe('Basic Operations', () => {
    test('get操作 - JSON数据', async () => {
      const testData = { price: 50000, volume: 1.5 };
      mockRedis.get.mockResolvedValue(JSON.stringify(testData));

      const result = await cacheService.get('test_key');

      expect(result).toEqual(testData);
      expect(mockRedis.get).toHaveBeenCalledWith('test_key');
    });

    test('get操作 - 字符串数据', async () => {
      const testData = 'simple_string';
      mockRedis.get.mockResolvedValue(testData);

      const result = await cacheService.get('test_key');

      expect(result).toBe(testData);
    });

    test('get操作失败应该抛出CacheError', async () => {
      mockRedis.get.mockRejectedValue(new Error('Redis connection failed'));

      await expect(cacheService.get('test_key')).rejects.toThrow(CacheError);
    });

    test('set操作 - 带TTL', async () => {
      mockRedis.setex.mockResolvedValue('OK');

      await cacheService.set('test_key', 'test_value', 300);

      expect(mockRedis.setex).toHaveBeenCalledWith('test_key', 300, 'test_value');
    });

    test('set操作 - 不带TTL', async () => {
      mockRedis.set.mockResolvedValue('OK');

      await cacheService.set('test_key', 'test_value');

      expect(mockRedis.set).toHaveBeenCalledWith('test_key', 'test_value');
    });

    test('set操作 - JSON对象', async () => {
      const testData = { price: 50000 };
      mockRedis.set.mockResolvedValue('OK');

      await cacheService.set('test_key', testData);

      expect(mockRedis.set).toHaveBeenCalledWith('test_key', JSON.stringify(testData));
    });

    test('set操作失败应该抛出CacheError', async () => {
      mockRedis.set.mockRejectedValue(new Error('Redis connection failed'));

      await expect(cacheService.set('test_key', 'test_value')).rejects.toThrow(CacheError);
    });
  });

  describe('Advanced Operations', () => {
    test('del操作', async () => {
      mockRedis.del.mockResolvedValue(1);

      await cacheService.del('test_key');

      expect(mockRedis.del).toHaveBeenCalledWith('test_key');
    });

    test('exists操作', async () => {
      mockRedis.exists.mockResolvedValue(1);

      const result = await cacheService.exists('test_key');

      expect(result).toBe(true);
      expect(mockRedis.exists).toHaveBeenCalledWith('test_key');
    });

    test('increment操作 - 首次创建', async () => {
      mockRedis.incr.mockResolvedValue(1);
      mockRedis.expire.mockResolvedValue(1);

      const result = await cacheService.increment('counter_key', 60);

      expect(result).toBe(1);
      expect(mockRedis.incr).toHaveBeenCalledWith('counter_key');
      expect(mockRedis.expire).toHaveBeenCalledWith('counter_key', 60);
    });

    test('increment操作 - 已存在', async () => {
      mockRedis.incr.mockResolvedValue(5);

      const result = await cacheService.increment('counter_key', 60);

      expect(result).toBe(5);
      expect(mockRedis.incr).toHaveBeenCalledWith('counter_key');
      expect(mockRedis.expire).not.toHaveBeenCalled();
    });

    test('ttl操作', async () => {
      mockRedis.ttl.mockResolvedValue(300);

      const result = await cacheService.ttl('test_key');

      expect(result).toBe(300);
      expect(mockRedis.ttl).toHaveBeenCalledWith('test_key');
    });
  });

  describe('Health Check', () => {
    test('健康检查成功', async () => {
      mockRedis.ping.mockResolvedValue('PONG');

      const result = await cacheService.healthCheck();

      expect(result).toBe(true);
      expect(mockRedis.ping).toHaveBeenCalled();
    });

    test('健康检查失败', async () => {
      mockRedis.ping.mockRejectedValue(new Error('Connection failed'));

      const result = await cacheService.healthCheck();

      expect(result).toBe(false);
    });
  });

  describe('Batch Operations', () => {
    test('mget操作', async () => {
      const keys = ['key1', 'key2', 'key3'];
      const values = ['value1', JSON.stringify({ data: 'value2' }), null];
      mockRedis.mget.mockResolvedValue(values);

      const result = await cacheService.mget(keys);

      expect(result).toEqual(['value1', { data: 'value2' }, null]);
      expect(mockRedis.mget).toHaveBeenCalledWith(...keys);
    });

    test('mset操作', async () => {
      const keyValuePairs = {
        key1: 'value1',
        key2: { data: 'value2' },
        key3: 123,
      };
      
      const mockPipeline = {
        set: jest.fn().mockReturnThis(),
        setex: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      };
      mockRedis.pipeline.mockReturnValue(mockPipeline);

      await cacheService.mset(keyValuePairs);

      expect(mockRedis.pipeline).toHaveBeenCalled();
      expect(mockPipeline.set).toHaveBeenCalledWith('key1', 'value1');
      expect(mockPipeline.set).toHaveBeenCalledWith('key2', JSON.stringify({ data: 'value2' }));
      expect(mockPipeline.set).toHaveBeenCalledWith('key3', JSON.stringify(123));
      expect(mockPipeline.exec).toHaveBeenCalled();
    });
  });

  describe('Key Naming Helpers', () => {
    test('静态方法应该生成正确的缓存键', () => {
      expect(CacheService.getTickerKey('binance', 'BTC/USDT')).toBe('ticker:binance:BTC/USDT');
      expect(CacheService.getDepthKey('okx', 'ETH/USDT')).toBe('depth:okx:ETH/USDT');
      expect(CacheService.getKlineKey('binance', 'BTC/USDT', '1h')).toBe('kline:binance:BTC/USDT:1h');
      expect(CacheService.getSymbolsKey('binance')).toBe('symbols:binance');
      expect(CacheService.getBalanceKey(123, 'binance')).toBe('balance:123:binance');
      expect(CacheService.getRateLimitKey(123, '/orders')).toBe('ratelimit:123:/orders');
      expect(CacheService.getUserKey('api_key_123')).toBe('user:api_key_123');
    });
  });

  describe('Connection Management', () => {
    test('关闭连接', async () => {
      mockRedis.quit.mockResolvedValue('OK');

      await cacheService.close();

      expect(mockRedis.quit).toHaveBeenCalled();
    });

    test('清空所有缓存', async () => {
      mockRedis.flushall.mockResolvedValue('OK');

      await cacheService.flushAll();

      expect(mockRedis.flushall).toHaveBeenCalled();
    });
  });
});