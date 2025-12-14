import { FastifyInstance } from 'fastify';
import { exchangeService } from '../services/ExchangeService';
import { createErrorResponse } from '../utils/error';

export async function marketRoutes(fastify: FastifyInstance) {
  // 获取行情数据
  fastify.get('/ticker/:symbol', async (request, reply) => {
    try {
      const { symbol } = request.params as { symbol: string };
      const { exchange = 'binance' } = request.query as { exchange?: string };
      
      const ticker = await exchangeService.getTicker(symbol, exchange);
      
      reply.send({
        success: true,
        data: ticker,
        timestamp: Date.now(),
      });
    } catch (error) {
      reply.send(createErrorResponse(error as Error));
    }
  });

  // 获取订单簿深度
  fastify.get('/depth/:symbol', async (request, reply) => {
    try {
      const { symbol } = request.params as { symbol: string };
      const { exchange = 'binance', limit = 20 } = request.query as { 
        exchange?: string; 
        limit?: number; 
      };
      
      const depth = await exchangeService.getOrderBook(symbol, exchange, limit);
      
      reply.send({
        success: true,
        data: depth,
        timestamp: Date.now(),
      });
    } catch (error) {
      reply.send(createErrorResponse(error as Error));
    }
  });

  // 获取K线数据
  fastify.get('/klines/:symbol', async (request, reply) => {
    try {
      const { symbol } = request.params as { symbol: string };
      const { 
        exchange = 'binance', 
        interval = '1h', 
        limit = 100 
      } = request.query as { 
        exchange?: string; 
        interval?: string; 
        limit?: number; 
      };
      
      const klines = await exchangeService.getKlines(symbol, interval, exchange, limit);
      
      reply.send({
        success: true,
        data: klines,
        timestamp: Date.now(),
      });
    } catch (error) {
      reply.send(createErrorResponse(error as Error));
    }
  });
}