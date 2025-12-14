import { FastifyRequest, FastifyReply } from 'fastify';
import { cacheService, CacheService } from '../services/CacheService';
import { Logger } from '../utils/logger';
import { RateLimitError } from '../utils/error';
import { configManager } from '../config';
import { getAuthData } from './auth';

export interface RateLimitConfig {
  windowMs: number; // 时间窗口（毫秒）
  maxRequests: number; // 最大请求数
  skipSuccessfulRequests?: boolean; // 是否跳过成功请求
  skipFailedRequests?: boolean; // 是否跳过失败请求
}

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: number; // 重置时间戳
  retryAfter?: number; // 重试等待时间（秒）
}

export class RateLimitService {
  private static instance: RateLimitService;
  private logger: Logger;
  private defaultConfig: RateLimitConfig;

  // 端点特定的限流配置
  private endpointConfigs: Map<string, RateLimitConfig> = new Map();

  private constructor() {
    this.logger = new Logger({ component: 'RateLimitService' });
    
    this.defaultConfig = {
      windowMs: configManager.app.rateLimitWindow,
      maxRequests: configManager.app.rateLimitMax,
    };

    this.initializeEndpointConfigs();
  }

  public static getInstance(): RateLimitService {
    if (!RateLimitService.instance) {
      RateLimitService.instance = new RateLimitService();
    }
    return RateLimitService.instance;
  }

  private initializeEndpointConfigs(): void {
    // 交易相关端点更严格的限流
    this.endpointConfigs.set('/api/v1/trade/order', {
      windowMs: 60000, // 1分钟
      maxRequests: 10, // 最多10个订单
    });

    this.endpointConfigs.set('/api/v1/trade/orders', {
      windowMs: 60000,
      maxRequests: 30,
    });

    // 市场数据端点相对宽松
    this.endpointConfigs.set('/api/v1/market/ticker', {
      windowMs: 60000,
      maxRequests: 200,
    });

    this.endpointConfigs.set('/api/v1/market/depth', {
      windowMs: 60000,
      maxRequests: 100,
    });

    this.endpointConfigs.set('/api/v1/market/klines', {
      windowMs: 60000,
      maxRequests: 50,
    });

    // 账户相关端点
    this.endpointConfigs.set('/api/v1/account/balance', {
      windowMs: 60000,
      maxRequests: 60,
    });

    this.logger.info(`Initialized rate limit configs for ${this.endpointConfigs.size} endpoints`);
  }

  private getConfig(endpoint: string): RateLimitConfig {
    // 尝试精确匹配
    let config = this.endpointConfigs.get(endpoint);
    if (config) {
      return config;
    }

    // 尝试模式匹配
    for (const [pattern, patternConfig] of this.endpointConfigs) {
      if (endpoint.startsWith(pattern)) {
        config = patternConfig;
        break;
      }
    }

    return config || this.defaultConfig;
  }

  private getRateLimitKey(identifier: string, endpoint: string): string {
    return CacheService.getRateLimitKey(parseInt(identifier) || 0, endpoint);
  }

  private getGlobalRateLimitKey(ip: string): string {
    return `ratelimit:global:${ip}`;
  }

  public async checkRateLimit(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<RateLimitInfo> {
    const endpoint = this.normalizeEndpoint(request.url);
    const config = this.getConfig(endpoint);
    
    // 获取用户标识符（优先使用用户ID，否则使用IP）
    let identifier: string;
    let isAuthenticated = false;
    
    try {
      const auth = getAuthData(request);
      identifier = auth.userId.toString();
      isAuthenticated = true;
    } catch {
      identifier = this.getClientIP(request);
    }

    // 检查用户/IP级别限流
    const userLimitInfo = await this.checkLimit(
      identifier,
      endpoint,
      config,
      isAuthenticated ? 'user' : 'ip'
    );

    // 如果是IP访问，还需要检查全局限流
    if (!isAuthenticated) {
      const globalConfig: RateLimitConfig = {
        windowMs: 60000, // 1分钟
        maxRequests: 1000, // 全局限制
      };
      
      const globalLimitInfo = await this.checkLimit(
        identifier,
        'global',
        globalConfig,
        'global'
      );

      // 返回更严格的限制
      if (globalLimitInfo.remaining < userLimitInfo.remaining) {
        return globalLimitInfo;
      }
    }

    return userLimitInfo;
  }

  private async checkLimit(
    identifier: string,
    endpoint: string,
    config: RateLimitConfig,
    type: 'user' | 'ip' | 'global'
  ): Promise<RateLimitInfo> {
    const key = type === 'global' 
      ? this.getGlobalRateLimitKey(identifier)
      : this.getRateLimitKey(identifier, endpoint);
    
    const windowSeconds = Math.ceil(config.windowMs / 1000);
    
    try {
      // 使用Redis INCR命令实现计数器
      const currentCount = await cacheService.increment(key, windowSeconds);
      
      const remaining = Math.max(0, config.maxRequests - currentCount);
      const resetTime = Date.now() + config.windowMs;
      
      const limitInfo: RateLimitInfo = {
        limit: config.maxRequests,
        remaining,
        reset: resetTime,
      };

      if (currentCount > config.maxRequests) {
        // 超出限制，计算重试等待时间
        const ttl = await cacheService.ttl(key);
        limitInfo.retryAfter = Math.max(1, ttl);
        
        this.logger.warn('Rate limit exceeded', {
          identifier,
          endpoint,
          type,
          currentCount,
          limit: config.maxRequests,
          retryAfter: limitInfo.retryAfter,
        });

        throw new RateLimitError('请求频率超限', {
          limit: config.maxRequests,
          current: currentCount,
          retryAfter: limitInfo.retryAfter,
        });
      }

      this.logger.debug('Rate limit check passed', {
        identifier,
        endpoint,
        type,
        currentCount,
        remaining,
      });

      return limitInfo;
    } catch (error) {
      if (error instanceof RateLimitError) {
        throw error;
      }
      
      this.logger.error('Rate limit check failed', error as Error, {
        identifier,
        endpoint,
        type,
      });
      
      // 如果Redis出错，允许请求通过但记录错误
      return {
        limit: config.maxRequests,
        remaining: config.maxRequests,
        reset: Date.now() + config.windowMs,
      };
    }
  }

  private normalizeEndpoint(url: string): string {
    // 移除查询参数
    const path = url.split('?')[0];
    
    // 将动态路径参数标准化
    return path
      .replace(/\/\d+/g, '/:id') // 数字ID
      .replace(/\/[A-Z]{2,10}\/[A-Z]{2,10}/g, '/:symbol') // 交易对符号
      .replace(/\/[a-f0-9-]{36}/g, '/:uuid'); // UUID
  }

  private getClientIP(request: FastifyRequest): string {
    const forwarded = request.headers['x-forwarded-for'] as string;
    const realIP = request.headers['x-real-ip'] as string;
    
    if (forwarded) {
      return forwarded.split(',')[0].trim();
    }
    
    if (realIP) {
      return realIP;
    }
    
    return request.ip || 'unknown';
  }

  public async recordRequest(
    request: FastifyRequest,
    statusCode: number
  ): Promise<void> {
    const config = this.getConfig(this.normalizeEndpoint(request.url));
    
    // 如果配置了跳过成功/失败请求，则相应处理
    if (config.skipSuccessfulRequests && statusCode < 400) {
      return;
    }
    
    if (config.skipFailedRequests && statusCode >= 400) {
      return;
    }

    // 这里可以添加额外的请求记录逻辑
    this.logger.debug('Request recorded for rate limiting', {
      url: request.url,
      method: request.method,
      statusCode,
    });
  }

  public setEndpointConfig(endpoint: string, config: RateLimitConfig): void {
    this.endpointConfigs.set(endpoint, config);
    this.logger.info('Rate limit config updated', { endpoint, config });
  }

  public getEndpointConfig(endpoint: string): RateLimitConfig {
    return this.getConfig(endpoint);
  }

  public async resetLimit(identifier: string, endpoint: string): Promise<void> {
    const key = this.getRateLimitKey(identifier, endpoint);
    await cacheService.del(key);
    this.logger.info('Rate limit reset', { identifier, endpoint });
  }
}

export const rateLimitService = RateLimitService.getInstance();

// Fastify中间件
export async function rateLimitMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const limitInfo = await rateLimitService.checkRateLimit(request, reply);
    
    // 添加限流信息到响应头
    reply.header('X-RateLimit-Limit', limitInfo.limit);
    reply.header('X-RateLimit-Remaining', limitInfo.remaining);
    reply.header('X-RateLimit-Reset', limitInfo.reset);
    
  } catch (error) {
    if (error instanceof RateLimitError) {
      const details = error.details as any;
      
      reply.status(429);
      
      if (details?.retryAfter) {
        reply.header('Retry-After', details.retryAfter);
      }
      
      reply.send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
          details: {
            limit: details?.limit,
            retryAfter: details?.retryAfter,
          },
        },
        timestamp: Date.now(),
      });
    } else {
      // 其他错误，允许请求继续
      request.log.error('Rate limit middleware error', error);
    }
  }
}

// 创建特定端点的限流中间件
export function createEndpointRateLimit(config: RateLimitConfig) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const endpoint = rateLimitService['normalizeEndpoint'](request.url);
    rateLimitService.setEndpointConfig(endpoint, config);
    
    return rateLimitMiddleware(request, reply);
  };
}