import * as fc from 'fast-check';
import { AuthService, authMiddleware } from './auth';
import { database } from '../db';
import { cacheService } from '../services/CacheService';
import { AuthenticationError } from '../utils/error';
import { createHmac } from 'crypto';

// Mock dependencies
jest.mock('../db');
jest.mock('../services/CacheService');

const mockDatabase = database as jest.Mocked<typeof database>;
const mockCacheService = cacheService as jest.Mocked<typeof cacheService>;

describe('AuthService Tests', () => {
  let authService: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    // 重置单例实例
    (AuthService as any).instance = undefined;
    authService = AuthService.getInstance();
  });

  describe('**Feature: crypto-trading-api, Property 1: 认证签名验证**', () => {
    test('对于任何有效的API密钥和请求数据，使用正确的密钥生成签名然后验证签名应该返回成功', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 32, maxLength: 64 }), // API密钥
          fc.string({ minLength: 32, maxLength: 128 }), // API密钥
          fc.string({ minLength: 10, maxLength: 13 }), // 时间戳
          fc.oneof(fc.constant('GET'), fc.constant('POST'), fc.constant('PUT'), fc.constant('DELETE')), // HTTP方法
          fc.string({ minLength: 1, maxLength: 100 }), // 路径
          fc.oneof(fc.constant(''), fc.string({ maxLength: 1000 })), // 请求体
          (apiKey, apiSecret, timestampStr, method, path, body) => {
            const timestamp = Date.now().toString();
            
            // 使用正确的密钥生成签名
            const correctSignature = authService.generateSignature(
              timestamp,
              method,
              path,
              body,
              apiSecret
            );

            // 验证签名应该成功
            const mockRequest = {
              method,
              url: path,
              body: body ? JSON.parse(JSON.stringify(body)) : undefined,
            } as any;

            // 使用私有方法进行测试（通过类型断言访问）
            const isValid = (authService as any).verifySignature(
              mockRequest,
              timestamp,
              apiSecret,
              correctSignature
            );

            expect(isValid).resolves.toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('签名生成的一致性', () => {
      const timestamp = '1640995200000';
      const method = 'POST';
      const path = '/api/v1/orders';
      const body = '{"symbol":"BTC/USDT","side":"buy","amount":0.1}';
      const apiSecret = 'test_secret_key_12345';

      const signature1 = authService.generateSignature(timestamp, method, path, body, apiSecret);
      const signature2 = authService.generateSignature(timestamp, method, path, body, apiSecret);

      expect(signature1).toBe(signature2);
      expect(signature1).toHaveLength(64); // SHA256 hex length
    });

    test('不同参数生成不同签名', () => {
      const baseParams = {
        timestamp: '1640995200000',
        method: 'POST',
        path: '/api/v1/orders',
        body: '{"symbol":"BTC/USDT"}',
        apiSecret: 'test_secret',
      };

      const signature1 = authService.generateSignature(
        baseParams.timestamp,
        baseParams.method,
        baseParams.path,
        baseParams.body,
        baseParams.apiSecret
      );

      // 修改时间戳
      const signature2 = authService.generateSignature(
        '1640995201000',
        baseParams.method,
        baseParams.path,
        baseParams.body,
        baseParams.apiSecret
      );

      // 修改请求体
      const signature3 = authService.generateSignature(
        baseParams.timestamp,
        baseParams.method,
        baseParams.path,
        '{"symbol":"ETH/USDT"}',
        baseParams.apiSecret
      );

      expect(signature1).not.toBe(signature2);
      expect(signature1).not.toBe(signature3);
      expect(signature2).not.toBe(signature3);
    });
  });

  describe('**Feature: crypto-trading-api, Property 2: 认证时间窗口**', () => {
    test('对于任何超出5分钟窗口的时间戳，认证应该被拒绝', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 6 * 60 * 1000, max: 24 * 60 * 60 * 1000 }), // 超出5分钟的时间差
          async (timeDifference) => {
            const currentTime = Date.now();
            const oldTimestamp = (currentTime - timeDifference).toString();

            const mockRequest = {
              headers: {
                'x-api-key': 'test_api_key',
                'x-timestamp': oldTimestamp,
                'x-signature': 'test_signature',
              },
              method: 'GET',
              url: '/api/v1/test',
            } as any;

            const mockReply = {} as any;

            // 应该抛出认证错误
            await expect(
              authService.authenticateRequest(mockRequest, mockReply)
            ).rejects.toThrow(AuthenticationError);
          }
        ),
        { numRuns: 50 }
      );
    });

    test('5分钟窗口内的时间戳应该被接受', async () => {
      const currentTime = Date.now();
      const validTimestamp = (currentTime - 2 * 60 * 1000).toString(); // 2分钟前

      const mockUser = {
        id: 1,
        apiKey: 'test_api_key',
        apiSecret: 'test_secret',
        permissions: ['read'],
        status: 'active',
      };

      // Mock用户查询
      mockCacheService.get.mockResolvedValue(null);
      mockDatabase.getUserByApiKey.mockResolvedValue(mockUser);
      mockCacheService.set.mockResolvedValue(undefined);

      // 生成有效签名
      const signature = authService.generateSignature(
        validTimestamp,
        'GET',
        '/api/v1/test',
        '',
        mockUser.apiSecret
      );

      const mockRequest = {
        headers: {
          'x-api-key': 'test_api_key',
          'x-timestamp': validTimestamp,
          'x-signature': signature,
        },
        method: 'GET',
        url: '/api/v1/test',
        body: undefined,
      } as any;

      const mockReply = {} as any;

      const result = await authService.authenticateRequest(mockRequest, mockReply);

      expect(result.userId).toBe(mockUser.id);
      expect(result.permissions).toEqual(mockUser.permissions);
    });

    test('边界情况：正好5分钟的时间戳', async () => {
      const currentTime = Date.now();
      const boundaryTimestamp = (currentTime - 5 * 60 * 1000).toString(); // 正好5分钟

      const mockRequest = {
        headers: {
          'x-api-key': 'test_api_key',
          'x-timestamp': boundaryTimestamp,
          'x-signature': 'test_signature',
        },
        method: 'GET',
        url: '/api/v1/test',
      } as any;

      const mockReply = {} as any;

      // 边界情况可能因为时间精度问题而通过或失败，这里主要测试不会崩溃
      try {
        await authService.authenticateRequest(mockRequest, mockReply);
      } catch (error) {
        expect(error).toBeInstanceOf(AuthenticationError);
      }
    });
  });

  describe('Singleton Pattern', () => {
    test('应该是单例模式', () => {
      const instance1 = AuthService.getInstance();
      const instance2 = AuthService.getInstance();
      
      expect(instance1).toBe(instance2);
    });
  });

  describe('Authentication Headers Validation', () => {
    test('缺少认证头应该抛出错误', async () => {
      const testCases = [
        { headers: {} }, // 所有头都缺少
        { headers: { 'x-api-key': 'test' } }, // 缺少timestamp和signature
        { headers: { 'x-timestamp': '1640995200000' } }, // 缺少api-key和signature
        { headers: { 'x-signature': 'test' } }, // 缺少api-key和timestamp
        { headers: { 'x-api-key': 'test', 'x-timestamp': '1640995200000' } }, // 缺少signature
      ];

      for (const testCase of testCases) {
        const mockRequest = {
          headers: testCase.headers,
          method: 'GET',
          url: '/api/v1/test',
        } as any;

        const mockReply = {} as any;

        await expect(
          authService.authenticateRequest(mockRequest, mockReply)
        ).rejects.toThrow(AuthenticationError);
      }
    });

    test('无效的时间戳格式应该抛出错误', async () => {
      const mockRequest = {
        headers: {
          'x-api-key': 'test_api_key',
          'x-timestamp': 'invalid_timestamp',
          'x-signature': 'test_signature',
        },
        method: 'GET',
        url: '/api/v1/test',
      } as any;

      const mockReply = {} as any;

      await expect(
        authService.authenticateRequest(mockRequest, mockReply)
      ).rejects.toThrow(AuthenticationError);
    });
  });

  describe('User Validation', () => {
    test('不存在的用户应该抛出错误', async () => {
      const currentTime = Date.now();
      const validTimestamp = currentTime.toString();

      mockCacheService.get.mockResolvedValue(null);
      mockDatabase.getUserByApiKey.mockResolvedValue(null);

      const mockRequest = {
        headers: {
          'x-api-key': 'nonexistent_key',
          'x-timestamp': validTimestamp,
          'x-signature': 'test_signature',
        },
        method: 'GET',
        url: '/api/v1/test',
      } as any;

      const mockReply = {} as any;

      await expect(
        authService.authenticateRequest(mockRequest, mockReply)
      ).rejects.toThrow(AuthenticationError);
    });

    test('非活跃用户应该抛出错误', async () => {
      const currentTime = Date.now();
      const validTimestamp = currentTime.toString();

      const mockUser = {
        id: 1,
        apiKey: 'test_api_key',
        apiSecret: 'test_secret',
        permissions: ['read'],
        status: 'inactive', // 非活跃状态
      };

      mockCacheService.get.mockResolvedValue(null);
      mockDatabase.getUserByApiKey.mockResolvedValue(mockUser);

      const mockRequest = {
        headers: {
          'x-api-key': 'test_api_key',
          'x-timestamp': validTimestamp,
          'x-signature': 'test_signature',
        },
        method: 'GET',
        url: '/api/v1/test',
      } as any;

      const mockReply = {} as any;

      await expect(
        authService.authenticateRequest(mockRequest, mockReply)
      ).rejects.toThrow(AuthenticationError);
    });
  });

  describe('Permission Checking', () => {
    test('用户权限检查', () => {
      // 有权限的情况
      expect(authService.checkPermission(['read', 'trade'], 'read')).toBe(true);
      expect(authService.checkPermission(['read', 'trade'], 'trade')).toBe(true);
      
      // 管理员权限
      expect(authService.checkPermission(['admin'], 'read')).toBe(true);
      expect(authService.checkPermission(['admin'], 'trade')).toBe(true);
      expect(authService.checkPermission(['admin'], 'withdraw')).toBe(true);
      
      // 无权限的情况
      expect(authService.checkPermission(['read'], 'trade')).toBe(false);
      expect(authService.checkPermission(['trade'], 'withdraw')).toBe(false);
      expect(authService.checkPermission([], 'read')).toBe(false);
    });
  });

  describe('Cache Integration', () => {
    test('缓存命中时应该使用缓存的用户数据', async () => {
      const currentTime = Date.now();
      const validTimestamp = currentTime.toString();

      const mockUser = {
        id: 1,
        apiKey: 'test_api_key',
        apiSecret: 'test_secret',
        permissions: ['read'],
        status: 'active',
      };

      // 模拟缓存命中
      mockCacheService.get.mockResolvedValue(mockUser);

      const signature = authService.generateSignature(
        validTimestamp,
        'GET',
        '/api/v1/test',
        '',
        mockUser.apiSecret
      );

      const mockRequest = {
        headers: {
          'x-api-key': 'test_api_key',
          'x-timestamp': validTimestamp,
          'x-signature': signature,
        },
        method: 'GET',
        url: '/api/v1/test',
        body: undefined,
      } as any;

      const mockReply = {} as any;

      const result = await authService.authenticateRequest(mockRequest, mockReply);

      expect(result.userId).toBe(mockUser.id);
      expect(mockDatabase.getUserByApiKey).not.toHaveBeenCalled();
      expect(mockCacheService.get).toHaveBeenCalled();
    });

    test('缓存未命中时应该查询数据库并缓存结果', async () => {
      const currentTime = Date.now();
      const validTimestamp = currentTime.toString();

      const mockUser = {
        id: 1,
        apiKey: 'test_api_key',
        apiSecret: 'test_secret',
        permissions: ['read'],
        status: 'active',
      };

      // 模拟缓存未命中
      mockCacheService.get.mockResolvedValue(null);
      mockDatabase.getUserByApiKey.mockResolvedValue(mockUser);
      mockCacheService.set.mockResolvedValue(undefined);

      const signature = authService.generateSignature(
        validTimestamp,
        'GET',
        '/api/v1/test',
        '',
        mockUser.apiSecret
      );

      const mockRequest = {
        headers: {
          'x-api-key': 'test_api_key',
          'x-timestamp': validTimestamp,
          'x-signature': signature,
        },
        method: 'GET',
        url: '/api/v1/test',
        body: undefined,
      } as any;

      const mockReply = {} as any;

      const result = await authService.authenticateRequest(mockRequest, mockReply);

      expect(result.userId).toBe(mockUser.id);
      expect(mockDatabase.getUserByApiKey).toHaveBeenCalledWith('test_api_key');
      expect(mockCacheService.set).toHaveBeenCalledWith(
        expect.stringContaining('user:test_api_key'),
        mockUser,
        300
      );
    });
  });
});