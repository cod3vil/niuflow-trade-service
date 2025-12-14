import { FastifyInstance } from 'fastify';
import { orderService } from '../services/OrderService';
import { authMiddleware, requirePermission, getAuthData } from '../middleware/auth';
import { createErrorResponse } from '../utils/error';

export async function tradeRoutes(fastify: FastifyInstance) {
  // 注册认证中间件
  fastify.addHook('preHandler', authMiddleware);
  fastify.addHook('preHandler', requirePermission('trade'));

  // 创建订单
  fastify.post('/order', async (request, reply) => {
    try {
      const auth = getAuthData(request);
      const orderData = request.body as any;
      
      const order = await orderService.createOrder({
        ...orderData,
        userId: auth.userId,
      });
      
      reply.send({
        success: true,
        data: order,
        timestamp: Date.now(),
      });
    } catch (error) {
      reply.send(createErrorResponse(error as Error));
    }
  });

  // 取消订单
  fastify.delete('/order/:id', async (request, reply) => {
    try {
      const auth = getAuthData(request);
      const { id } = request.params as { id: string };
      
      const order = await orderService.cancelOrder(parseInt(id), auth.userId);
      
      reply.send({
        success: true,
        data: order,
        timestamp: Date.now(),
      });
    } catch (error) {
      reply.send(createErrorResponse(error as Error));
    }
  });

  // 查询订单
  fastify.get('/order/:id', async (request, reply) => {
    try {
      const auth = getAuthData(request);
      const { id } = request.params as { id: string };
      
      const order = await orderService.getOrder(parseInt(id), auth.userId);
      
      reply.send({
        success: true,
        data: order,
        timestamp: Date.now(),
      });
    } catch (error) {
      reply.send(createErrorResponse(error as Error));
    }
  });

  // 查询订单列表
  fastify.get('/orders', async (request, reply) => {
    try {
      const auth = getAuthData(request);
      const query = request.query as any;
      
      const result = await orderService.getUserOrders({
        userId: auth.userId,
        ...query,
      });
      
      reply.send({
        success: true,
        data: result,
        timestamp: Date.now(),
      });
    } catch (error) {
      reply.send(createErrorResponse(error as Error));
    }
  });
}