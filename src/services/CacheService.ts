import Redis from 'ioredis';
import { configManager } from '../config';
import { Logger } from '../utils/logger';
import { CacheError } from '../utils/error';

export class CacheService {
  private static instance: CacheService;
  private redis: Redis;
  private logger: Logger;

  private constructor() {
    this.logger = new Logger({ component: 'CacheService' });
    
    this.redis = new Redis({
      host: configManager.redis.host,
      port: configManager.redis.port,
      password: configManager.redis.password,
      db: configManager.redis.db,
      enableReadyCheck: false,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });

    this.redis.on('connect', () => {
      this.logger.info('Redis connected');
    });

    this.redis.on('error', (error) => {
      this.logger.error('Redis connection error', error);
    });

    this.redis.on('close', () => {
      this.logger.warn('Redis connection closed');
    });

    this.redis.on('reconnecting', () => {
      this.logger.info('Redis reconnecting');
    });
  }

  public static getInstance(): CacheService {
    if (!CacheService.instance) {
      CacheService.instance = new CacheService();
    }
    return CacheService.instance;
  }

  public async get<T = any>(key: string): Promise<T | null> {
    try {
      const value = await this.redis.get(key);
      if (value === null) {
        return null;
      }
      
      try {
        return JSON.parse(value) as T;
      } catch {
        // 如果不是JSON，直接返回字符串
        return value as unknown as T;
      }
    } catch (error) {
      this.logger.error('Cache get operation failed', error as Error, { key });
      throw new CacheError(`Failed to get cache key: ${key}`, { key });
    }
  }

  public async set(key: string, value: any, ttl?: number): Promise<void> {
    try {
      const serializedValue = typeof value === 'string' ? value : JSON.stringify(value);
      
      if (ttl) {
        await this.redis.setex(key, ttl, serializedValue);
      } else {
        await this.redis.set(key, serializedValue);
      }
      
      this.logger.debug('Cache set operation completed', { key, ttl });
    } catch (error) {
      this.logger.error('Cache set operation failed', error as Error, { key, ttl });
      throw new CacheError(`Failed to set cache key: ${key}`, { key, ttl });
    }
  }

  public async del(key: string): Promise<void> {
    try {
      await this.redis.del(key);
      this.logger.debug('Cache delete operation completed', { key });
    } catch (error) {
      this.logger.error('Cache delete operation failed', error as Error, { key });
      throw new CacheError(`Failed to delete cache key: ${key}`, { key });
    }
  }

  public async exists(key: string): Promise<boolean> {
    try {
      const result = await this.redis.exists(key);
      return result === 1;
    } catch (error) {
      this.logger.error('Cache exists operation failed', error as Error, { key });
      throw new CacheError(`Failed to check cache key existence: ${key}`, { key });
    }
  }

  public async increment(key: string, ttl?: number): Promise<number> {
    try {
      const result = await this.redis.incr(key);
      
      if (ttl && result === 1) {
        // 只在第一次创建时设置TTL
        await this.redis.expire(key, ttl);
      }
      
      this.logger.debug('Cache increment operation completed', { key, result, ttl });
      return result;
    } catch (error) {
      this.logger.error('Cache increment operation failed', error as Error, { key, ttl });
      throw new CacheError(`Failed to increment cache key: ${key}`, { key, ttl });
    }
  }

  public async decrement(key: string): Promise<number> {
    try {
      const result = await this.redis.decr(key);
      this.logger.debug('Cache decrement operation completed', { key, result });
      return result;
    } catch (error) {
      this.logger.error('Cache decrement operation failed', error as Error, { key });
      throw new CacheError(`Failed to decrement cache key: ${key}`, { key });
    }
  }

  public async expire(key: string, ttl: number): Promise<void> {
    try {
      await this.redis.expire(key, ttl);
      this.logger.debug('Cache expire operation completed', { key, ttl });
    } catch (error) {
      this.logger.error('Cache expire operation failed', error as Error, { key, ttl });
      throw new CacheError(`Failed to set expiration for cache key: ${key}`, { key, ttl });
    }
  }

  public async ttl(key: string): Promise<number> {
    try {
      return await this.redis.ttl(key);
    } catch (error) {
      this.logger.error('Cache TTL operation failed', error as Error, { key });
      throw new CacheError(`Failed to get TTL for cache key: ${key}`, { key });
    }
  }

  public async healthCheck(): Promise<boolean> {
    try {
      const result = await this.redis.ping();
      return result === 'PONG';
    } catch (error) {
      this.logger.error('Redis health check failed', error as Error);
      return false;
    }
  }

  public async flushAll(): Promise<void> {
    try {
      await this.redis.flushall();
      this.logger.info('Cache flushed all keys');
    } catch (error) {
      this.logger.error('Cache flush all operation failed', error as Error);
      throw new CacheError('Failed to flush all cache keys');
    }
  }

  public async close(): Promise<void> {
    try {
      await this.redis.quit();
      this.logger.info('Redis connection closed');
    } catch (error) {
      this.logger.error('Error closing Redis connection', error as Error);
      throw error;
    }
  }

  // 缓存键命名规范的辅助方法
  public static getTickerKey(exchange: string, symbol: string): string {
    return `ticker:${exchange}:${symbol}`;
  }

  public static getDepthKey(exchange: string, symbol: string): string {
    return `depth:${exchange}:${symbol}`;
  }

  public static getKlineKey(exchange: string, symbol: string, interval: string): string {
    return `kline:${exchange}:${symbol}:${interval}`;
  }

  public static getSymbolsKey(exchange: string): string {
    return `symbols:${exchange}`;
  }

  public static getBalanceKey(userId: number, exchange: string): string {
    return `balance:${userId}:${exchange}`;
  }

  public static getRateLimitKey(userId: number, endpoint: string): string {
    return `ratelimit:${userId}:${endpoint}`;
  }

  public static getUserKey(apiKey: string): string {
    return `user:${apiKey}`;
  }

  // 批量操作
  public async mget<T = any>(keys: string[]): Promise<(T | null)[]> {
    try {
      const values = await this.redis.mget(...keys);
      return values.map(value => {
        if (value === null) return null;
        try {
          return JSON.parse(value) as T;
        } catch {
          return value as unknown as T;
        }
      });
    } catch (error) {
      this.logger.error('Cache mget operation failed', error as Error, { keys });
      throw new CacheError('Failed to get multiple cache keys', { keys });
    }
  }

  public async mset(keyValuePairs: Record<string, any>, ttl?: number): Promise<void> {
    try {
      const pipeline = this.redis.pipeline();
      
      Object.entries(keyValuePairs).forEach(([key, value]) => {
        const serializedValue = typeof value === 'string' ? value : JSON.stringify(value);
        if (ttl) {
          pipeline.setex(key, ttl, serializedValue);
        } else {
          pipeline.set(key, serializedValue);
        }
      });
      
      await pipeline.exec();
      this.logger.debug('Cache mset operation completed', { 
        keyCount: Object.keys(keyValuePairs).length, 
        ttl 
      });
    } catch (error) {
      this.logger.error('Cache mset operation failed', error as Error, { 
        keyCount: Object.keys(keyValuePairs).length 
      });
      throw new CacheError('Failed to set multiple cache keys');
    }
  }
}

export const cacheService = CacheService.getInstance();