import * as fc from 'fast-check';
import { ExchangeService } from './ExchangeService';
import { CacheService } from './CacheService';
import { ExchangeError, InsufficientBalanceError } from '../utils/error';

// Mock ccxt
jest.mock('ccxt', () => {
  const mockExchange = {
    fetchTicker: jest.fn(),
    fetchOrderBook: jest.fn(),
    fetchOHLCV: jest.fn(),
    createOrder: jest.fn(),
    cancelOrder: jest.fn(),
    fetchBalance: jest.fn(),
    fetchOrder: jest.fn(),
    loadMarkets: jest.fn(),
    fetchStatus: jest.fn(),
  };

  return {
    binance: jest.fn(() => mockExchange),
    okx: jest.fn(() => mockExchange),
    __mockExchange: mockExchange,
  };
});

// Mock CacheService
jest.mock('./CacheService');

const ccxt = require('ccxt');
const MockedCacheService = CacheService as jest.MockedClass<typeof CacheService>;

describe('ExchangeService Tests', () => {
  let exchangeService: ExchangeService;
  let mockCacheService: jest.Mocked<CacheService>;
  let mockExchange: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // 重置单例实例
    (ExchangeService as any).instance = undefined;
    
    // 设置缓存服务mock
    mockCacheService = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      exists: jest.fn(),
      increment: jest.fn(),
      healthCheck: jest.fn(),
    } as any;
    
    MockedCacheService.getInstance.mockReturnValue(mockCacheService);
    
    mockExchange = ccxt.__mockExchange;
    exchangeService = ExchangeService.getInstance();
  });

  describe('**Feature: crypto-trading-api, Property 3: 市场数据格式一致性**', () => {
    test('对于任何有效的交易对，行情数据响应应该包含价格、买价、卖价和成交量字段', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 3, maxLength: 20 }).filter(s => s.includes('/')),
          fc.oneof(fc.constant('binance'), fc.constant('okx')),
          async (symbol, exchange) => {
            // 模拟交易所返回的ticker数据
            const mockTickerResponse = {
              symbol: symbol,
              last: fc.sample(fc.float({ min: 0.001, max: 100000 }), 1)[0],
              bid: fc.sample(fc.float({ min: 0.001, max: 100000 }), 1)[0],
              ask: fc.sample(fc.float({ min: 0.001, max: 100000 }), 1)[0],
              baseVolume: fc.sample(fc.float({ min: 0, max: 1000000 }), 1)[0],
              change: fc.sample(fc.float({ min: -1000, max: 1000 }), 1)[0],
              percentage: fc.sample(fc.float({ min: -100, max: 100 }), 1)[0],
              high: fc.sample(fc.float({ min: 0.001, max: 100000 }), 1)[0],
              low: fc.sample(fc.float({ min: 0.001, max: 100000 }), 1)[0],
              timestamp: Date.now(),
            };

            // 模拟缓存未命中
            mockCacheService.get.mockResolvedValue(null);
            mockCacheService.set.mockResolvedValue(undefined);
            
            // 模拟交易所API调用
            mockExchange.fetchTicker.mockResolvedValue(mockTickerResponse);

            // 调用getTicker方法
            const result = await exchangeService.getTicker(symbol, exchange);

            // 验证返回的数据包含所有必需字段
            expect(result).toHaveProperty('symbol');
            expect(result).toHaveProperty('last');
            expect(result).toHaveProperty('bid');
            expect(result).toHaveProperty('ask');
            expect(result).toHaveProperty('volume');
            expect(result).toHaveProperty('change');
            expect(result).toHaveProperty('changePercent');
            expect(result).toHaveProperty('high');
            expect(result).toHaveProperty('low');
            expect(result).toHaveProperty('timestamp');

            // 验证数据类型
            expect(typeof result.symbol).toBe('string');
            expect(typeof result.last).toBe('number');
            expect(typeof result.bid).toBe('number');
            expect(typeof result.ask).toBe('number');
            expect(typeof result.volume).toBe('number');
            expect(typeof result.timestamp).toBe('number');

            // 验证数据被缓存
            expect(mockCacheService.set).toHaveBeenCalledWith(
              expect.stringContaining(`ticker:${exchange}:${symbol}`),
              result,
              5
            );
          }
        ),
        { numRuns: 50 }
      );
    });

    test('订单簿数据应该包含买卖盘信息', async () => {
      const symbol = 'BTC/USDT';
      const exchange = 'binance';
      
      const mockOrderBookResponse = {
        symbol: symbol,
        bids: [[50000, 1.5], [49999, 2.0], [49998, 1.0]],
        asks: [[50001, 1.2], [50002, 1.8], [50003, 0.5]],
        timestamp: Date.now(),
      };

      mockCacheService.get.mockResolvedValue(null);
      mockCacheService.set.mockResolvedValue(undefined);
      mockExchange.fetchOrderBook.mockResolvedValue(mockOrderBookResponse);

      const result = await exchangeService.getOrderBook(symbol, exchange, 20);

      expect(result).toHaveProperty('symbol');
      expect(result).toHaveProperty('bids');
      expect(result).toHaveProperty('asks');
      expect(result).toHaveProperty('timestamp');
      
      expect(Array.isArray(result.bids)).toBe(true);
      expect(Array.isArray(result.asks)).toBe(true);
      expect(result.bids.length).toBeGreaterThan(0);
      expect(result.asks.length).toBeGreaterThan(0);
      
      // 验证买卖盘数据格式
      result.bids.forEach(bid => {
        expect(Array.isArray(bid)).toBe(true);
        expect(bid.length).toBe(2);
        expect(typeof bid[0]).toBe('number'); // 价格
        expect(typeof bid[1]).toBe('number'); // 数量
      });
    });

    test('K线数据应该包含OHLCV信息', async () => {
      const symbol = 'BTC/USDT';
      const exchange = 'binance';
      const timeframe = '1h';
      
      const mockOHLCVResponse = [
        [1640995200000, 50000, 51000, 49500, 50500, 100.5],
        [1640998800000, 50500, 51500, 50000, 51000, 95.2],
        [1641002400000, 51000, 52000, 50500, 51500, 88.7],
      ];

      mockCacheService.get.mockResolvedValue(null);
      mockCacheService.set.mockResolvedValue(undefined);
      mockExchange.fetchOHLCV.mockResolvedValue(mockOHLCVResponse);

      const result = await exchangeService.getKlines(symbol, timeframe, exchange, 100);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      
      result.forEach(kline => {
        expect(kline).toHaveProperty('timestamp');
        expect(kline).toHaveProperty('open');
        expect(kline).toHaveProperty('high');
        expect(kline).toHaveProperty('low');
        expect(kline).toHaveProperty('close');
        expect(kline).toHaveProperty('volume');
        
        expect(typeof kline.timestamp).toBe('number');
        expect(typeof kline.open).toBe('number');
        expect(typeof kline.high).toBe('number');
        expect(typeof kline.low).toBe('number');
        expect(typeof kline.close).toBe('number');
        expect(typeof kline.volume).toBe('number');
      });
    });
  });

  describe('Singleton Pattern', () => {
    test('应该是单例模式', () => {
      const instance1 = ExchangeService.getInstance();
      const instance2 = ExchangeService.getInstance();
      
      expect(instance1).toBe(instance2);
    });
  });

  describe('Cache Integration', () => {
    test('缓存命中时应该返回缓存数据', async () => {
      const symbol = 'BTC/USDT';
      const exchange = 'binance';
      const cachedData = {
        symbol,
        last: 50000,
        bid: 49999,
        ask: 50001,
        volume: 100,
        change: 500,
        changePercent: 1.0,
        high: 51000,
        low: 49000,
        timestamp: Date.now(),
      };

      mockCacheService.get.mockResolvedValue(cachedData);

      const result = await exchangeService.getTicker(symbol, exchange);

      expect(result).toEqual(cachedData);
      expect(mockExchange.fetchTicker).not.toHaveBeenCalled();
      expect(mockCacheService.get).toHaveBeenCalledWith(
        expect.stringContaining(`ticker:${exchange}:${symbol}`)
      );
    });

    test('缓存未命中时应该调用交易所API并缓存结果', async () => {
      const symbol = 'ETH/USDT';
      const exchange = 'binance';
      
      const mockTickerResponse = {
        symbol,
        last: 3000,
        bid: 2999,
        ask: 3001,
        baseVolume: 500,
        change: 100,
        percentage: 3.45,
        high: 3100,
        low: 2900,
        timestamp: Date.now(),
      };

      mockCacheService.get.mockResolvedValue(null);
      mockCacheService.set.mockResolvedValue(undefined);
      mockExchange.fetchTicker.mockResolvedValue(mockTickerResponse);

      const result = await exchangeService.getTicker(symbol, exchange);

      expect(mockExchange.fetchTicker).toHaveBeenCalledWith(symbol);
      expect(mockCacheService.set).toHaveBeenCalledWith(
        expect.stringContaining(`ticker:${exchange}:${symbol}`),
        expect.objectContaining({
          symbol,
          last: 3000,
          bid: 2999,
          ask: 3001,
        }),
        5
      );
    });
  });

  describe('Error Handling', () => {
    test('交易所API错误应该被正确处理', async () => {
      const symbol = 'INVALID/PAIR';
      const exchange = 'binance';

      mockCacheService.get.mockResolvedValue(null);
      mockExchange.fetchTicker.mockRejectedValue(new Error('Invalid symbol'));

      await expect(
        exchangeService.getTicker(symbol, exchange)
      ).rejects.toThrow();
    });

    test('不支持的交易所应该抛出错误', async () => {
      await expect(
        exchangeService.getTicker('BTC/USDT', 'unsupported_exchange')
      ).rejects.toThrow(ExchangeError);
    });

    test('余额不足错误应该被正确识别', async () => {
      const orderParams = {
        symbol: 'BTC/USDT',
        side: 'buy' as const,
        type: 'limit' as const,
        amount: 1.0,
        price: 50000,
      };

      mockExchange.createOrder.mockRejectedValue(new Error('Insufficient balance'));

      await expect(
        exchangeService.createOrder(orderParams, 'binance')
      ).rejects.toThrow(InsufficientBalanceError);
    });
  });

  describe('Retry Mechanism', () => {
    test('网络错误应该触发重试', async () => {
      const symbol = 'BTC/USDT';
      const exchange = 'binance';

      mockCacheService.get.mockResolvedValue(null);
      mockCacheService.set.mockResolvedValue(undefined);
      
      // 前两次调用失败，第三次成功
      mockExchange.fetchTicker
        .mockRejectedValueOnce(new Error('Network timeout'))
        .mockRejectedValueOnce(new Error('Connection failed'))
        .mockResolvedValueOnce({
          symbol,
          last: 50000,
          bid: 49999,
          ask: 50001,
          baseVolume: 100,
          timestamp: Date.now(),
        });

      const result = await exchangeService.getTicker(symbol, exchange);

      expect(mockExchange.fetchTicker).toHaveBeenCalledTimes(3);
      expect(result).toHaveProperty('symbol', symbol);
    });

    test('非重试错误应该立即抛出', async () => {
      const orderParams = {
        symbol: 'BTC/USDT',
        side: 'buy' as const,
        type: 'limit' as const,
        amount: 1.0,
        price: 50000,
      };

      mockExchange.createOrder.mockRejectedValue(new Error('Invalid symbol'));

      await expect(
        exchangeService.createOrder(orderParams, 'binance')
      ).rejects.toThrow();

      // 不应该重试
      expect(mockExchange.createOrder).toHaveBeenCalledTimes(1);
    });
  });

  describe('Balance Operations', () => {
    test('余额查询应该返回正确格式', async () => {
      const userId = 123;
      const exchange = 'binance';
      
      const mockBalanceResponse = {
        total: { BTC: 1.5, USDT: 10000, ETH: 0 },
        free: { BTC: 1.0, USDT: 8000, ETH: 0 },
        used: { BTC: 0.5, USDT: 2000, ETH: 0 },
      };

      mockCacheService.get.mockResolvedValue(null);
      mockCacheService.set.mockResolvedValue(undefined);
      mockExchange.fetchBalance.mockResolvedValue(mockBalanceResponse);

      const result = await exchangeService.fetchBalance(userId, exchange);

      expect(Array.isArray(result)).toBe(true);
      
      // 应该只返回余额大于0的币种
      expect(result.length).toBe(2);
      
      result.forEach(balance => {
        expect(balance).toHaveProperty('currency');
        expect(balance).toHaveProperty('free');
        expect(balance).toHaveProperty('used');
        expect(balance).toHaveProperty('total');
        expect(balance.total).toBeGreaterThan(0);
      });
    });
  });

  describe('Health Check', () => {
    test('健康检查应该返回所有交易所状态', async () => {
      mockExchange.fetchStatus.mockResolvedValue({ status: 'ok' });

      const result = await exchangeService.healthCheck();

      expect(typeof result).toBe('object');
      expect(Object.keys(result).length).toBeGreaterThan(0);
      
      Object.values(result).forEach(status => {
        expect(typeof status).toBe('boolean');
      });
    });
  });

  describe('Supported Exchanges', () => {
    test('应该返回支持的交易所列表', () => {
      const exchanges = exchangeService.getSupportedExchanges();
      
      expect(Array.isArray(exchanges)).toBe(true);
      expect(exchanges.length).toBeGreaterThan(0);
      
      exchanges.forEach(exchange => {
        expect(typeof exchange).toBe('string');
      });
    });
  });
});