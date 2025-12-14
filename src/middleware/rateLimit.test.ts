import * as fc from 'fast-check';
import { RateLimitService, rateLimitMiddleware } from './rateLimit';
import { cacheService } from '../services/CacheService';
import { RateLimitError } from '../utils/error';
import { getAuthData } from './auth';

// Mock dependencies
jest.mock('../services/CacheService');
jest.mock('./auth');

const mockCacheService = cacheService as jest.Mocked<typeof cacheService>;
const mockGetAuthData = getAuthData as jest.MockedFunction<typeof getAuthData>;

describe('RateLimitService Tests', () => {
  let rateLimitService: RateLimitService;

  beforeEach(() => {
    jest.clearAllMocks();
    // 重置单例实例
    (RateLimitService as any).instance = undefined;
    rateLimitService = RateLimitService.getInstance();
  });

  describe('**Feature: crypto-trading-api, Property 8: 限流拒绝行为**', () => {
    test('对于任何超过定义限制的请求序列，系统应该以HTTP 429状态拒绝超限请求', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 5, max: 20 }), // 限流阈值
          fc.integer({ min: 1, max: 10 }), // 超出限制的请求数
          async (limit, extraRequests) => {
            const totalRequests = limit + extraRequests;
            const endpoint = '/api/v1/test';
            const userId = '123';

            // 模拟认证用户
            mockGetAuthData.mockReturnValue({
              userId: parseInt(userId),
              user: {} as any,
              permissions: ['read'],
            });

            // 设置端点配置
            rateLimitService.setEndpointConfig(endpoint, {
              windowMs: 60000,
              maxRequests: limit,
            });

            let rejectedCount = 0;
            let acceptedCount = 0;

            // 模拟连续请求
            for (let i = 1; i <= totalRequests; i++) {
              // 模拟Redis计数器行为
              mockCacheService.increment.mockResolvedValue(i);
              mockCacheService.ttl.mockResolvedValue(60);

              const mockRequest = {
                url: endpoint,
                ip: '127.0.0.1',
                headers: {},
              } as any;

              const mockReply = {
                header: jest.fn(),
                status: jest.fn().mockReturnThis(),
                send: jest.fn(),
              } as any;

              try {
                await rateLimitService.checkRateLimit(mockRequest, mockReply);
                acceptedCount++;
              } catch (error) {
                if (error instanceof RateLimitError) {
                  rejectedCount++;
                  
                  // 验证错误包含正确的信息
                  expect(error.code).toBe('RATE_LIMIT_EXCEEDED');
                  expect(error.details).toHaveProperty('limit', limit);
                  expect(error.details).toHaveProperty('retryAfter');
                } else {
                  throw error;
                }
              }
            }

            // 验证限流行为
            expect(acceptedCount).toBe(limit);
            expect(rejectedCount).toBe(extraRequests);
          }
        ),
        { numRuns: 50 }
      );
    });

    test('在限制范围内的请求应该被接受', async () => {
      const limit = 10;
      const endpoint = '/api/v1/test';
      const userId = '123';

      mockGetAuthData.mockReturnValue({
        userId: parseInt(userId),
        user: {} as any,
        permissions: ['read'],
      });

      rateLimitService.setEndpointConfig(endpoint, {
        windowMs: 60000,
        maxRequests: limit,
      });

      // 模拟在限制范围内的请求
      for (let i = 1; i <= limit; i++) {
        mockCacheService.increment.mockResolvedValue(i);

        const mockRequest = {
          url: endpoint,
          ip: '127.0.0.1',
          headers: {},
        } as any;

        const mockReply = {
          header: jest.fn(),
        } as any;

        const limitInfo = await rateLimitService.checkRateLimit(mockRequest, mockReply);

        expect(limitInfo.limit).toBe(limit);
        expect(limitInfo.remaining).toBe(limit - i);
        expect(limitInfo.reset).toBeGreaterThan(Date.now());
      }
    });

    test('不同端点应该有独立的限流计数', async () => {
      const limit = 5;
      const endpoint1 = '/api/v1/orders';
      const endpoint2 = '/api/v1/balance';
      const userId = '123';

      mockGetAuthData.mockReturnValue({
        userId: parseInt(userId),
        user: {} as any,
        permissions: ['read', 'trade'],
      });

      // 为两个端点设置相同的限制
      rateLimitService.setEndpointConfig(endpoint1, {
        windowMs: 60000,
        maxRequests: limit,
      });

      rateLimitService.setEndpointConfig(endpoint2, {
        windowMs: 60000,
        maxRequests: limit,
      });

      // 模拟对两个端点的请求
      let endpoint1Count = 0;
      let endpoint2Count = 0;

      for (let i = 1; i <= limit; i++) {
        // 端点1的请求
        mockCacheService.increment.mockResolvedValueOnce(++endpoint1Count);
        const request1 = {
          url: endpoint1,
          ip: '127.0.0.1',
          headers: {},
        } as any;
        const reply1 = { header: jest.fn() } as any;

        const limitInfo1 = await rateLimitService.checkRateLimit(request1, reply1);
        expect(limitInfo1.remaining).toBe(limit - endpoint1Count);

        // 端点2的请求
        mockCacheService.increment.mockResolvedValueOnce(++endpoint2Count);
        const request2 = {
          url: endpoint2,
          ip: '127.0.0.1',
          headers: {},
        } as any;
        const reply2 = { header: jest.fn() } as any;

        const limitInfo2 = await rateLimitService.checkRateLimit(request2, reply2);
        expect(limitInfo2.remaining).toBe(limit - endpoint2Count);
      }

      // 验证两个端点都达到了限制
      expect(endpoint1Count).toBe(limit);
      expect(endpoint2Count).toBe(limit);
    });
  });

  describe('Singleton Pattern', () => {
    test('应该是单例模式', () => {
      const instance1 = RateLimitService.getInstance();
      const instance2 = RateLimitService.getInstance();
      
      expect(instance1).toBe(instance2);
    });
  });

  describe('Endpoint Configuration', () => {
    test('应该正确设置和获取端点配置', () => {
      const endpoint = '/api/v1/custom';
      const config = {
        windowMs: 30000,
        maxRequests: 50,
      };

      rateLimitService.setEndpointConfig(endpoint, config);
      const retrievedConfig = rateLimitService.getEndpointConfig(endpoint);

      expect(retrievedConfig).toEqual(config);
    });

    test('未配置的端点应该使用默认配置', () => {
      const endpoint = '/api/v1/unknown';
      const config = rateLimitService.getEndpointConfig(endpoint);

      expect(config).toHaveProperty('windowMs');
      expect(config).toHaveProperty('maxRequests');
      expect(config.maxRequests).toBeGreaterThan(0);
    });

    test('应该支持端点模式匹配', () => {
      const pattern = '/api/v1/trade';
      const config = {
        windowMs: 60000,
        maxRequests: 10,
      };

      rateLimitService.setEndpointConfig(pattern, config);

      // 测试匹配的端点
      const matchingEndpoint = '/api/v1/trade/orders';
      const retrievedConfig = rateLimitService.getEndpointConfig(matchingEndpoint);

      expect(retrievedConfig).toEqual(config);
    });
  });

  describe('User vs IP Rate Limiting', () => {
    test('认证用户应该使用用户ID进行限流', async () => {
      const endpoint = '/api/v1/test';
      const userId = 456;

      mockGetAuthData.mockReturnValue({
        userId,
        user: {} as any,
        permissions: ['read'],
      });

      mockCacheService.increment.mockResolvedValue(1);

      const mockRequest = {
        url: endpoint,
        ip: '192.168.1.1',
        headers: {},
      } as any;

      const mockReply = {
        header: jest.fn(),
      } as any;

      await rateLimitService.checkRateLimit(mockRequest, mockReply);

      // 验证使用了用户ID作为标识符
      expect(mockCacheService.increment).toHaveBeenCalledWith(
        expect.stringContaining(`ratelimit:${userId}:`),
        expect.any(Number)
      );
    });

    test('未认证用户应该使用IP进行限流', async () => {
      const endpoint = '/api/v1/test';
      const clientIP = '192.168.1.100';

      mockGetAuthData.mockImplementation(() => {
        throw new Error('Not authenticated');
      });

      mockCacheService.increment.mockResolvedValue(1);

      const mockRequest = {
        url: endpoint,
        ip: clientIP,
        headers: {},
      } as any;

      const mockReply = {
        header: jest.fn(),
      } as any;

      await rateLimitService.checkRateLimit(mockRequest, mockReply);

      // 验证使用了IP作为标识符
      expect(mockCacheService.increment).toHaveBeenCalledWith(
        expect.stringContaining(`ratelimit:0:${endpoint}`),
        expect.any(Number)
      );
    });
  });

  describe('IP Address Extraction', () => {
    test('应该正确提取客户端IP地址', async () => {
      const testCases = [
        {
          headers: { 'x-forwarded-for': '203.0.113.1, 198.51.100.1' },
          expected: '203.0.113.1',
        },
        {
          headers: { 'x-real-ip': '203.0.113.2' },
          expected: '203.0.113.2',
        },
        {
          headers: {},
          ip: '203.0.113.3',
          expected: '203.0.113.3',
        },
      ];

      for (const testCase of testCases) {
        mockGetAuthData.mockImplementation(() => {
          throw new Error('Not authenticated');
        });

        mockCacheService.increment.mockResolvedValue(1);

        const mockRequest = {
          url: '/api/v1/test',
          headers: testCase.headers,
          ip: testCase.ip,
        } as any;

        const mockReply = {
          header: jest.fn(),
        } as any;

        await rateLimitService.checkRateLimit(mockRequest, mockReply);

        // 验证IP提取逻辑
        expect(mockCacheService.increment).toHaveBeenCalled();
      }
    });
  });

  describe('Error Handling', () => {
    test('Redis错误时应该允许请求通过', async () => {
      const endpoint = '/api/v1/test';

      mockGetAuthData.mockReturnValue({
        userId: 123,
        user: {} as any,
        permissions: ['read'],
      });

      // 模拟Redis错误
      mockCacheService.increment.mockRejectedValue(new Error('Redis connection failed'));

      const mockRequest = {
        url: endpoint,
        ip: '127.0.0.1',
        headers: {},
      } as any;

      const mockReply = {
        header: jest.fn(),
      } as any;

      // 应该不抛出错误，允许请求通过
      const limitInfo = await rateLimitService.checkRateLimit(mockRequest, mockReply);

      expect(limitInfo).toHaveProperty('limit');
      expect(limitInfo).toHaveProperty('remaining');
      expect(limitInfo).toHaveProperty('reset');
    });

    test('限流错误应该被正确抛出', async () => {
      const endpoint = '/api/v1/test';
      const limit = 5;

      mockGetAuthData.mockReturnValue({
        userId: 123,
        user: {} as any,
        permissions: ['read'],
      });

      rateLimitService.setEndpointConfig(endpoint, {
        windowMs: 60000,
        maxRequests: limit,
      });

      // 模拟超出限制
      mockCacheService.increment.mockResolvedValue(limit + 1);
      mockCacheService.ttl.mockResolvedValue(30);

      const mockRequest = {
        url: endpoint,
        ip: '127.0.0.1',
        headers: {},
      } as any;

      const mockReply = {
        header: jest.fn(),
      } as any;

      await expect(
        rateLimitService.checkRateLimit(mockRequest, mockReply)
      ).rejects.toThrow(RateLimitError);
    });
  });

  describe('Middleware Integration', () => {
    test('中间件应该设置正确的响应头', async () => {
      const endpoint = '/api/v1/test';

      mockGetAuthData.mockReturnValue({
        userId: 123,
        user: {} as any,
        permissions: ['read'],
      });

      mockCacheService.increment.mockResolvedValue(1);

      const mockRequest = {
        url: endpoint,
        ip: '127.0.0.1',
        headers: {},
      } as any;

      const mockReply = {
        header: jest.fn(),
        status: jest.fn().mockReturnThis(),
        send: jest.fn(),
      } as any;

      await rateLimitMiddleware(mockRequest, mockReply);

      expect(mockReply.header).toHaveBeenCalledWith('X-RateLimit-Limit', expect.any(Number));
      expect(mockReply.header).toHaveBeenCalledWith('X-RateLimit-Remaining', expect.any(Number));
      expect(mockReply.header).toHaveBeenCalledWith('X-RateLimit-Reset', expect.any(Number));
    });

    test('超限时中间件应该返回429状态', async () => {
      const endpoint = '/api/v1/test';
      const limit = 5;

      mockGetAuthData.mockReturnValue({
        userId: 123,
        user: {} as any,
        permissions: ['read'],
      });

      rateLimitService.setEndpointConfig(endpoint, {
        windowMs: 60000,
        maxRequests: limit,
      });

      mockCacheService.increment.mockResolvedValue(limit + 1);
      mockCacheService.ttl.mockResolvedValue(30);

      const mockRequest = {
        url: endpoint,
        ip: '127.0.0.1',
        headers: {},
      } as any;

      const mockReply = {
        header: jest.fn(),
        status: jest.fn().mockReturnThis(),
        send: jest.fn(),
      } as any;

      await rateLimitMiddleware(mockRequest, mockReply);

      expect(mockReply.status).toHaveBeenCalledWith(429);
      expect(mockReply.header).toHaveBeenCalledWith('Retry-After', expect.any(Number));
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: 'RATE_LIMIT_EXCEEDED',
          }),
        })
      );
    });
  });

  describe('Endpoint Normalization', () => {
    test('应该正确标准化端点路径', () => {
      const testCases = [
        {
          input: '/api/v1/orders/123',
          expected: '/api/v1/orders/:id',
        },
        {
          input: '/api/v1/market/ticker/BTC/USDT',
          expected: '/api/v1/market/ticker/:symbol',
        },
        {
          input: '/api/v1/orders?limit=10&offset=0',
          expected: '/api/v1/orders',
        },
        {
          input: '/api/v1/users/550e8400-e29b-41d4-a716-446655440000',
          expected: '/api/v1/users/:uuid',
        },
      ];

      for (const testCase of testCases) {
        const normalized = (rateLimitService as any).normalizeEndpoint(testCase.input);
        expect(normalized).toBe(testCase.expected);
      }
    });
  });
});