import ccxt from 'ccxt';
import { configManager } from '../config';
import { Logger } from '../utils/logger';
import { CacheService } from './CacheService';
import { ExchangeError, InsufficientBalanceError } from '../utils/error';
import { TickerData, OrderBookData, KlineData, Balance, OrderParams } from '../types';

export class ExchangeService {
  private static instance: ExchangeService;
  private exchanges: Map<string, ccxt.Exchange> = new Map();
  private logger: Logger;
  private cacheService: CacheService;

  private constructor() {
    this.logger = new Logger({ component: 'ExchangeService' });
    this.cacheService = CacheService.getInstance();
    this.initializeExchanges();
  }

  public static getInstance(): ExchangeService {
    if (!ExchangeService.instance) {
      ExchangeService.instance = new ExchangeService();
    }
    return ExchangeService.instance;
  }

  private initializeExchanges(): void {
    // 初始化币安交易所
    if (configManager.exchanges.binance) {
      const binance = new ccxt.binance({
        apiKey: configManager.exchanges.binance.apiKey,
        secret: configManager.exchanges.binance.secret,
        sandbox: configManager.exchanges.binance.sandbox,
        enableRateLimit: true,
        timeout: 30000,
      });
      this.exchanges.set('binance', binance);
      this.logger.info('Binance exchange initialized');
    }

    // 初始化欧易交易所
    if (configManager.exchanges.okx) {
      const okx = new ccxt.okx({
        apiKey: configManager.exchanges.okx.apiKey,
        secret: configManager.exchanges.okx.secret,
        password: configManager.exchanges.okx.passphrase,
        sandbox: configManager.exchanges.okx.sandbox,
        enableRateLimit: true,
        timeout: 30000,
      });
      this.exchanges.set('okx', okx);
      this.logger.info('OKX exchange initialized');
    }

    this.logger.info(`Initialized ${this.exchanges.size} exchanges`);
  }

  private getExchange(exchangeName: string): ccxt.Exchange {
    const exchange = this.exchanges.get(exchangeName.toLowerCase());
    if (!exchange) {
      throw new ExchangeError(`Exchange ${exchangeName} not configured or supported`);
    }
    return exchange;
  }

  private async retryOperation<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 1000
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        
        // 检查是否是不应该重试的错误
        if (this.isNonRetryableError(error as Error)) {
          throw error;
        }

        if (attempt === maxRetries) {
          break;
        }

        // 指数退避
        const delay = baseDelay * Math.pow(2, attempt - 1);
        this.logger.warn(`Operation failed, retrying in ${delay}ms`, lastError, {
          attempt,
          maxRetries,
        });
        
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    this.logger.error('Operation failed after all retries', lastError!);
    throw lastError!;
  }

  private isNonRetryableError(error: Error): boolean {
    const message = error.message.toLowerCase();
    
    // 余额不足等业务错误不应该重试
    if (message.includes('insufficient') || 
        message.includes('balance') ||
        message.includes('invalid symbol') ||
        message.includes('invalid order')) {
      return true;
    }

    return false;
  }

  public async getTicker(symbol: string, exchange: string = 'binance'): Promise<TickerData> {
    const cacheKey = CacheService.getTickerKey(exchange, symbol);
    
    // 尝试从缓存获取
    const cached = await this.cacheService.get<TickerData>(cacheKey);
    if (cached) {
      this.logger.debug('Ticker data served from cache', { symbol, exchange });
      return cached;
    }

    // 从交易所获取
    const exchangeInstance = this.getExchange(exchange);
    
    const ticker = await this.retryOperation(async () => {
      return await exchangeInstance.fetchTicker(symbol);
    });

    const tickerData: TickerData = {
      symbol: ticker.symbol,
      last: ticker.last || 0,
      bid: ticker.bid || 0,
      ask: ticker.ask || 0,
      volume: ticker.baseVolume || 0,
      change: ticker.change || 0,
      changePercent: ticker.percentage || 0,
      high: ticker.high || 0,
      low: ticker.low || 0,
      timestamp: ticker.timestamp || Date.now(),
    };

    // 缓存5秒
    await this.cacheService.set(cacheKey, tickerData, 5);
    
    this.logger.debug('Ticker data fetched and cached', { symbol, exchange });
    return tickerData;
  }

  public async getOrderBook(symbol: string, exchange: string = 'binance', limit: number = 20): Promise<OrderBookData> {
    const cacheKey = CacheService.getDepthKey(exchange, symbol);
    
    // 尝试从缓存获取
    const cached = await this.cacheService.get<OrderBookData>(cacheKey);
    if (cached) {
      this.logger.debug('Order book data served from cache', { symbol, exchange });
      return cached;
    }

    // 从交易所获取
    const exchangeInstance = this.getExchange(exchange);
    
    const orderBook = await this.retryOperation(async () => {
      return await exchangeInstance.fetchOrderBook(symbol, limit);
    });

    const orderBookData: OrderBookData = {
      symbol: orderBook.symbol,
      bids: orderBook.bids.slice(0, limit),
      asks: orderBook.asks.slice(0, limit),
      timestamp: orderBook.timestamp || Date.now(),
    };

    // 缓存3秒
    await this.cacheService.set(cacheKey, orderBookData, 3);
    
    this.logger.debug('Order book data fetched and cached', { symbol, exchange, limit });
    return orderBookData;
  }

  public async getKlines(
    symbol: string, 
    timeframe: string = '1h', 
    exchange: string = 'binance',
    limit: number = 100
  ): Promise<KlineData[]> {
    const cacheKey = CacheService.getKlineKey(exchange, symbol, timeframe);
    
    // 尝试从缓存获取
    const cached = await this.cacheService.get<KlineData[]>(cacheKey);
    if (cached) {
      this.logger.debug('Kline data served from cache', { symbol, exchange, timeframe });
      return cached;
    }

    // 从交易所获取
    const exchangeInstance = this.getExchange(exchange);
    
    const ohlcv = await this.retryOperation(async () => {
      return await exchangeInstance.fetchOHLCV(symbol, timeframe, undefined, limit);
    });

    const klineData: KlineData[] = ohlcv.map(candle => ({
      timestamp: candle[0],
      open: candle[1],
      high: candle[2],
      low: candle[3],
      close: candle[4],
      volume: candle[5],
    }));

    // 缓存1分钟
    await this.cacheService.set(cacheKey, klineData, 60);
    
    this.logger.debug('Kline data fetched and cached', { symbol, exchange, timeframe, count: klineData.length });
    return klineData;
  }

  public async createOrder(
    params: OrderParams,
    exchange: string,
    userExchangeCredentials?: { apiKey: string; secret: string; passphrase?: string }
  ): Promise<any> {
    let exchangeInstance = this.getExchange(exchange);

    // 如果提供了用户的交易所凭据，创建临时实例
    if (userExchangeCredentials) {
      const ExchangeClass = ccxt[exchange as keyof typeof ccxt] as any;
      exchangeInstance = new ExchangeClass({
        apiKey: userExchangeCredentials.apiKey,
        secret: userExchangeCredentials.secret,
        password: userExchangeCredentials.passphrase,
        sandbox: exchange === 'binance' ? configManager.exchanges.binance?.sandbox : configManager.exchanges.okx?.sandbox,
        enableRateLimit: true,
        timeout: 30000,
      });
    }

    const order = await this.retryOperation(async () => {
      try {
        return await exchangeInstance.createOrder(
          params.symbol,
          params.type,
          params.side,
          params.amount,
          params.price
        );
      } catch (error) {
        const errorMessage = (error as Error).message.toLowerCase();
        
        if (errorMessage.includes('insufficient') || errorMessage.includes('balance')) {
          throw new InsufficientBalanceError('余额不足', {
            symbol: params.symbol,
            side: params.side,
            amount: params.amount,
          });
        }
        
        throw new ExchangeError(`订单创建失败: ${(error as Error).message}`, {
          exchange,
          params,
        });
      }
    });

    this.logger.info('Order created successfully', {
      exchange,
      orderId: order.id,
      symbol: params.symbol,
      side: params.side,
      amount: params.amount,
    });

    return order;
  }

  public async cancelOrder(orderId: string, symbol: string, exchange: string, userExchangeCredentials?: any): Promise<any> {
    let exchangeInstance = this.getExchange(exchange);

    // 如果提供了用户的交易所凭据，创建临时实例
    if (userExchangeCredentials) {
      const ExchangeClass = ccxt[exchange as keyof typeof ccxt] as any;
      exchangeInstance = new ExchangeClass({
        apiKey: userExchangeCredentials.apiKey,
        secret: userExchangeCredentials.secret,
        password: userExchangeCredentials.passphrase,
        sandbox: exchange === 'binance' ? configManager.exchanges.binance?.sandbox : configManager.exchanges.okx?.sandbox,
        enableRateLimit: true,
        timeout: 30000,
      });
    }

    const result = await this.retryOperation(async () => {
      return await exchangeInstance.cancelOrder(orderId, symbol);
    });

    this.logger.info('Order canceled successfully', {
      exchange,
      orderId,
      symbol,
    });

    return result;
  }

  public async fetchBalance(userId: number, exchange: string, userExchangeCredentials?: any): Promise<Balance[]> {
    const cacheKey = CacheService.getBalanceKey(userId, exchange);
    
    // 尝试从缓存获取
    const cached = await this.cacheService.get<Balance[]>(cacheKey);
    if (cached) {
      this.logger.debug('Balance data served from cache', { userId, exchange });
      return cached;
    }

    let exchangeInstance = this.getExchange(exchange);

    // 如果提供了用户的交易所凭据，创建临时实例
    if (userExchangeCredentials) {
      const ExchangeClass = ccxt[exchange as keyof typeof ccxt] as any;
      exchangeInstance = new ExchangeClass({
        apiKey: userExchangeCredentials.apiKey,
        secret: userExchangeCredentials.secret,
        password: userExchangeCredentials.passphrase,
        sandbox: exchange === 'binance' ? configManager.exchanges.binance?.sandbox : configManager.exchanges.okx?.sandbox,
        enableRateLimit: true,
        timeout: 30000,
      });
    }

    const balance = await this.retryOperation(async () => {
      return await exchangeInstance.fetchBalance();
    });

    const balances: Balance[] = Object.entries(balance.total)
      .filter(([currency, amount]) => (amount as number) > 0)
      .map(([currency, total]) => ({
        currency,
        free: balance.free[currency] || 0,
        used: balance.used[currency] || 0,
        total: total as number,
      }));

    // 缓存30秒
    await this.cacheService.set(cacheKey, balances, 30);
    
    this.logger.debug('Balance data fetched and cached', { userId, exchange, currencies: balances.length });
    return balances;
  }

  public async fetchOrder(orderId: string, symbol: string, exchange: string, userExchangeCredentials?: any): Promise<any> {
    let exchangeInstance = this.getExchange(exchange);

    // 如果提供了用户的交易所凭据，创建临时实例
    if (userExchangeCredentials) {
      const ExchangeClass = ccxt[exchange as keyof typeof ccxt] as any;
      exchangeInstance = new ExchangeClass({
        apiKey: userExchangeCredentials.apiKey,
        secret: userExchangeCredentials.secret,
        password: userExchangeCredentials.passphrase,
        sandbox: exchange === 'binance' ? configManager.exchanges.binance?.sandbox : configManager.exchanges.okx?.sandbox,
        enableRateLimit: true,
        timeout: 30000,
      });
    }

    const order = await this.retryOperation(async () => {
      return await exchangeInstance.fetchOrder(orderId, symbol);
    });

    this.logger.debug('Order fetched successfully', {
      exchange,
      orderId,
      symbol,
      status: order.status,
    });

    return order;
  }

  public async getExchangeSymbols(exchange: string): Promise<string[]> {
    const cacheKey = CacheService.getSymbolsKey(exchange);
    
    // 尝试从缓存获取
    const cached = await this.cacheService.get<string[]>(cacheKey);
    if (cached) {
      this.logger.debug('Symbols served from cache', { exchange });
      return cached;
    }

    const exchangeInstance = this.getExchange(exchange);
    
    const markets = await this.retryOperation(async () => {
      return await exchangeInstance.loadMarkets();
    });

    const symbols = Object.keys(markets);

    // 缓存1小时
    await this.cacheService.set(cacheKey, symbols, 3600);
    
    this.logger.debug('Symbols fetched and cached', { exchange, count: symbols.length });
    return symbols;
  }

  public getSupportedExchanges(): string[] {
    return Array.from(this.exchanges.keys());
  }

  public async healthCheck(): Promise<{ [exchange: string]: boolean }> {
    const results: { [exchange: string]: boolean } = {};

    for (const [name, exchange] of this.exchanges) {
      try {
        await exchange.fetchStatus();
        results[name] = true;
      } catch (error) {
        this.logger.error(`Health check failed for ${name}`, error as Error);
        results[name] = false;
      }
    }

    return results;
  }
}

export const exchangeService = ExchangeService.getInstance();