import { FastifyRequest, FastifyReply } from 'fastify';
import { createHmac } from 'crypto';
import { database } from '../db';
import { cacheService, CacheService } from '../services/CacheService';
import { Logger } from '../utils/logger';
import { AuthenticationError, AuthorizationError } from '../utils/error';
import { User, AuthenticatedRequest } from '../types';

export interface AuthHeaders {
  'x-api-key': string;
  'x-timestamp': string;
  'x-signature': string;
}

export class AuthService {
  private static instance: AuthService;
  private logger: Logger;
  private readonly TIME_WINDOW = 5 * 60 * 1000; // 5分钟

  private constructor() {
    this.logger = new Logger({ component: 'AuthService' });
  }

  public static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService();
    }
    return AuthService.instance;
  }

  public async authenticateRequest(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<AuthenticatedRequest> {
    const headers = request.headers as Partial<AuthHeaders>;
    
    // 检查必需的认证头
    const apiKey = headers['x-api-key'];
    const timestamp = headers['x-timestamp'];
    const signature = headers['x-signature'];

    if (!apiKey || !timestamp || !signature) {
      this.logger.warn('Missing authentication headers', {
        hasApiKey: !!apiKey,
        hasTimestamp: !!timestamp,
        hasSignature: !!signature,
      });
      throw new AuthenticationError('缺少认证头信息');
    }

    // 验证时间戳窗口
    const requestTime = parseInt(timestamp);
    const currentTime = Date.now();
    
    if (isNaN(requestTime)) {
      throw new AuthenticationError('无效的时间戳格式');
    }

    if (Math.abs(currentTime - requestTime) > this.TIME_WINDOW) {
      this.logger.warn('Request timestamp outside time window', {
        requestTime,
        currentTime,
        difference: Math.abs(currentTime - requestTime),
        timeWindow: this.TIME_WINDOW,
      });
      throw new AuthenticationError('请求时间戳超出有效窗口');
    }

    // 获取用户信息（优先从缓存）
    const user = await this.getUserByApiKey(apiKey);
    if (!user) {
      this.logger.warn('User not found for API key', { apiKey: apiKey.substring(0, 8) + '...' });
      throw new AuthenticationError('无效的API密钥');
    }

    if (user.status !== 'active') {
      this.logger.warn('Inactive user attempted authentication', { 
        userId: user.id, 
        status: user.status 
      });
      throw new AuthenticationError('用户账户已被禁用');
    }

    // 验证签名
    const isValidSignature = await this.verifySignature(
      request,
      timestamp,
      user.apiSecret,
      signature
    );

    if (!isValidSignature) {
      this.logger.warn('Invalid signature', { 
        userId: user.id,
        apiKey: apiKey.substring(0, 8) + '...',
      });
      throw new AuthenticationError('签名验证失败');
    }

    this.logger.debug('Authentication successful', { 
      userId: user.id,
      permissions: user.permissions,
    });

    return {
      userId: user.id,
      user,
      permissions: user.permissions,
    };
  }

  private async getUserByApiKey(apiKey: string): Promise<User | null> {
    // 尝试从缓存获取
    const cacheKey = CacheService.getUserKey(apiKey);
    const cachedUser = await cacheService.get<User>(cacheKey);
    
    if (cachedUser) {
      this.logger.debug('User data served from cache', { userId: cachedUser.id });
      return cachedUser;
    }

    // 从数据库获取
    const user = await database.getUserByApiKey(apiKey);
    
    if (user) {
      // 缓存用户信息5分钟
      await cacheService.set(cacheKey, user, 300);
      this.logger.debug('User data fetched and cached', { userId: user.id });
    }

    return user;
  }

  private async verifySignature(
    request: FastifyRequest,
    timestamp: string,
    apiSecret: string,
    providedSignature: string
  ): Promise<boolean> {
    try {
      const method = request.method;
      const path = request.url;
      const body = request.body ? JSON.stringify(request.body) : '';
      
      // 构建签名消息: timestamp + method + path + body
      const message = timestamp + method + path + body;
      
      // 计算HMAC-SHA256签名
      const expectedSignature = createHmac('sha256', apiSecret)
        .update(message)
        .digest('hex');

      return expectedSignature === providedSignature;
    } catch (error) {
      this.logger.error('Error verifying signature', error as Error);
      return false;
    }
  }

  public generateSignature(
    timestamp: string,
    method: string,
    path: string,
    body: string,
    apiSecret: string
  ): string {
    const message = timestamp + method + path + body;
    return createHmac('sha256', apiSecret)
      .update(message)
      .digest('hex');
  }

  public checkPermission(
    userPermissions: string[],
    requiredPermission: string
  ): boolean {
    return userPermissions.includes(requiredPermission) || userPermissions.includes('admin');
  }
}

export const authService = AuthService.getInstance();

// Fastify中间件
export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const authData = await authService.authenticateRequest(request, reply);
    
    // 将认证信息附加到请求对象
    (request as any).auth = authData;
  } catch (error) {
    if (error instanceof AuthenticationError) {
      reply.status(401).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
        timestamp: Date.now(),
      });
    } else {
      reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: '服务器内部错误',
        },
        timestamp: Date.now(),
      });
    }
  }
}

// 权限检查中间件工厂
export function requirePermission(permission: string) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const auth = (request as any).auth as AuthenticatedRequest;
    
    if (!auth) {
      throw new AuthenticationError('未认证的请求');
    }

    if (!authService.checkPermission(auth.permissions, permission)) {
      throw new AuthorizationError(`需要权限: ${permission}`);
    }
  };
}

// 获取认证信息的辅助函数
export function getAuthData(request: FastifyRequest): AuthenticatedRequest {
  const auth = (request as any).auth as AuthenticatedRequest;
  if (!auth) {
    throw new AuthenticationError('未认证的请求');
  }
  return auth;
}