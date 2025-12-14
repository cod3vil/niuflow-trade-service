import * as fc from 'fast-check';
import { OrderService } from './OrderService';
import { database } from '../db';
import { ExchangeService } from './ExchangeService';

// Mock dependencies
jest.mock('../db');
jest.mock('./ExchangeService');

const mockDatabase = database as jest.Mocked<typeof database>;
const mockExchangeService = ExchangeService.getInstance() as jest.Mocked<ExchangeService>;

describe('OrderService Tests', () => {
  let orderService: OrderService;

  beforeEach(() => {
    jest.clearAllMocks();
    (OrderService as any).instance = undefined;
    orderService = OrderService.getInstance();
  });

  describe('**Feature: crypto-trading-api, Property 5: 订单数据持久化**', () => {
    test('对于任何成功创建的订单，数据库中应该存在包含所有必需字段的对应记录', () => {
      fc.assert(
        fc.property(
          fc.record({
            userId: fc.integer({ min: 1, max: 1000 }),
            exchange: fc.constantFrom('binance', 'okx'),
            symbol: fc.constantFrom('BTC/USDT', 'ETH/USDT', 'BNB/USDT'),
            side: fc.constantFrom('buy', 'sell'),
            type: fc.constantFrom('limit', 'market'),
            amount: fc.float({ min: 0.001, max: 100 }),
            price: fc.float({ min: 1, max: 100000 }),
          }),
          async (orderRequest) => {
            // Mock用户数据
            const mockUser = {
              id: orderRequest.userId,
              exchange_api_key: 'encrypted_key',
              exchange_secret: 'encrypted_secret',
            };

            // Mock数据库操作
            const mockDbOrder = {
              id: 123,
              ...orderRequest,
              status: 'pending',
              created_at: new Date(),
            };

            const mockUpdatedOrder = {
              ...mockDbOrder,
              status: 'filled',
              exchange_order_id: 'exchange_123',
            };

            mockDatabase.transaction.mockImplementation(async (callback) => {
              return await callback({} as any);
            });
            mockDatabase.createOrder.mockResolvedValue(mockDbOrder);
            mockDatabase.updateOrderStatus.mockResolvedValue(mockUpdatedOrder);
            mockDatabase.query.mockResolvedValue({ rows: [mockUser] });

            // Mock交易所服务
            mockExchangeService.createOrder.mockResolvedValue({
              id: 'exchange_123',
              status: 'closed',
              filled: orderRequest.amount,
            });

            // 创建订单
            const result = await orderService.createOrder(orderRequest);

            // 验证数据库中存在包含所有必需字段的记录
            expect(mockDatabase.createOrder).toHaveBeenCalledWith(
              expect.objectContaining({
                userId: orderRequest.userId,
                exchange: orderRequest.exchange,
                symbol: orderRequest.symbol,
                side: orderRequest.side,
                type: orderRequest.type,
                amount: orderRequest.amount,
                price: orderRequest.price,
              })
            );

            expect(result).toHaveProperty('id');
            expect(result).toHaveProperty('userId', orderRequest.userId);
            expect(result).toHaveProperty('exchange', orderRequest.exchange);
            expect(result).toHaveProperty('symbol', orderRequest.symbol);
            expect(result).toHaveProperty('side', orderRequest.side);
            expect(result).toHaveProperty('type', orderRequest.type);
            expect(result).toHaveProperty('amount', orderRequest.amount);
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe('**Feature: crypto-trading-api, Property 6: 订单状态同步**', () => {
    test('对于任何取消的订单，系统状态和数据库记录应该反映取消状态', async () => {
      const orderId = 123;
      const userId = 456;

      const mockOrder = {
        id: orderId,
        user_id: userId,
        status: 'pending',
        exchange: 'binance',
        symbol: 'BTC/USDT',
        exchange_order_id: 'exchange_123',
        filled: 0,
        fee: null,
        fee_currency: null,
      };

      const mockUser = {
        id: userId,
        exchange_api_key: 'encrypted_key',
        exchange_secret: 'encrypted_secret',
      };

      const mockCanceledOrder = {
        ...mockOrder,
        status: 'canceled',
      };

      mockDatabase.getOrderById.mockResolvedValue(mockOrder);
      mockDatabase.query.mockResolvedValue({ rows: [mockUser] });
      mockDatabase.updateOrderStatus.mockResolvedValue(mockCanceledOrder);
      mockExchangeService.cancelOrder.mockResolvedValue({});

      const result = await orderService.cancelOrder(orderId, userId);

      expect(result.status).toBe('canceled');
      expect(mockDatabase.updateOrderStatus).toHaveBeenCalledWith(
        orderId,
        'canceled',
        expect.any(Number),
        expect.anything(),
        expect.anything(),
        undefined
      );
    });
  });
});