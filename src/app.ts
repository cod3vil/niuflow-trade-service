import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { configManager } from './config';
import { logger } from './utils/logger';
import { rateLimitMiddleware } from './middleware/rateLimit';
import { database } from './db';
import { cacheService } from './services/CacheService';
import { exchangeService } from './services/ExchangeService';
import { marketRoutes } from './routes/market';
import { tradeRoutes } from './routes/trade';
import { accountRoutes } from './routes/account';

const fastify = Fastify({
  logger: logger,
  trustProxy: true,
});

// 注册插件
fastify.register(cors, {
  origin: true,
  credentials: true,
});

fastify.register(helmet, {
  contentSecurityPolicy: false,
});

// 全局限流中间件
fastify.addHook('preHandler', rateLimitMiddleware);

// 健康检查
fastify.get('/api/v1/ping', async (request, reply) => {
  const dbHealth = await database.healthCheck();
  const cacheHealth = await cacheService.healthCheck();
  const exchangeHealth = await exchangeService.healthCheck();

  const isHealthy = dbHealth && cacheHealth;

  reply.status(isHealthy ? 200 : 503).send({
    success: isHealthy,
    data: {
      status: isHealthy ? 'healthy' : 'unhealthy',
      timestamp: Date.now(),
      checks: {
        database: dbHealth ? 'ok' : 'error',
        cache: cacheHealth ? 'ok' : 'error',
        exchanges: exchangeHealth,
      },
    },
  });
});

// 服务器时间
fastify.get('/api/v1/time', async (request, reply) => {
  reply.send({
    success: true,
    data: {
      serverTime: Date.now(),
      iso: new Date().toISOString(),
    },
    timestamp: Date.now(),
  });
});

// 支持的交易所
fastify.get('/api/v1/exchanges', async (request, reply) => {
  reply.send({
    success: true,
    data: exchangeService.getSupportedExchanges(),
    timestamp: Date.now(),
  });
});

// 注册路由
fastify.register(marketRoutes, { prefix: '/api/v1/market' });
fastify.register(tradeRoutes, { prefix: '/api/v1/trade' });
fastify.register(accountRoutes, { prefix: '/api/v1/account' });

// 错误处理
fastify.setErrorHandler((error, request, reply) => {
  request.log.error(error);
  
  reply.status(500).send({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: '服务器内部错误',
    },
    timestamp: Date.now(),
  });
});

// 启动服务器
const start = async () => {
  try {
    await fastify.listen({
      port: configManager.app.port,
      host: configManager.app.host,
    });
    
    logger.info(`Server listening on ${configManager.app.host}:${configManager.app.port}`);
  } catch (err) {
    logger.error('Error starting server', err as Error);
    process.exit(1);
  }
};

// 优雅关闭
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully');
  
  try {
    await fastify.close();
    await database.close();
    await cacheService.close();
    logger.info('Server closed successfully');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', error as Error);
    process.exit(1);
  }
});

if (require.main === module) {
  start();
}

export default fastify;