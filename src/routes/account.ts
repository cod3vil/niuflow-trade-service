import { FastifyInstance } from 'fastify';
import { exchangeService } from '../services/ExchangeService';
import { authMiddleware, getAuthData } from '../middleware/auth';
import { createErrorResponse } from '../utils/error';

export async function accountRoutes(fastify: FastifyInstance) {
  // 注册认证中间件
  fastify.addHook('preHandler', authMiddleware);

  // 查询余额
  fastify.get('/balance', async (request, reply) => {
    try {
      const auth = getAuthData(request);
      const { exchange = 'binance' } = request.query as { exchange?: string };
      
      const balances = await exchangeService.fetchBalance(auth.userId, exchange);
      
      reply.send({
        success: true,
        data: balances,
        timestamp: Date.now(),
      });
    } catch (error) {
      reply.send(createErrorResponse(error as Error));
    }
  });

  // 查询账户信息
  fastify.get('/info', async (request, reply) => {
    try {
      const auth = getAuthData(request);
      
      reply.send({
        success: true,
        data: {
          userId: auth.userId,
          permissions: auth.permissions,
        },
        timestamp: Date.now(),
      });
    } catch (error) {
      reply.send(createErrorResponse(error as Error));
    }
  });
}