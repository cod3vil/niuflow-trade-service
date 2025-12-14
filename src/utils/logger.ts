import pino from 'pino';
import { configManager } from '../config';

const isDevelopment = configManager.app.nodeEnv === 'development';

export const logger = pino({
  level: configManager.app.logLevel,
  transport: isDevelopment ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  } : undefined,
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  serializers: {
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
    err: pino.stdSerializers.err,
  },
});

export interface LogContext {
  userId?: number;
  requestId?: string;
  endpoint?: string;
  method?: string;
  statusCode?: number;
  responseTime?: number;
  error?: Error;
  [key: string]: any;
}

export class Logger {
  private context: LogContext;

  constructor(context: LogContext = {}) {
    this.context = context;
  }

  public info(message: string, data?: any): void {
    logger.info({ ...this.context, ...data }, message);
  }

  public error(message: string, error?: Error, data?: any): void {
    logger.error({ ...this.context, err: error, ...data }, message);
  }

  public warn(message: string, data?: any): void {
    logger.warn({ ...this.context, ...data }, message);
  }

  public debug(message: string, data?: any): void {
    logger.debug({ ...this.context, ...data }, message);
  }

  public child(additionalContext: LogContext): Logger {
    return new Logger({ ...this.context, ...additionalContext });
  }

  public static createRequestLogger(requestId: string, method: string, endpoint: string): Logger {
    return new Logger({ requestId, method, endpoint });
  }
}

export const rootLogger = new Logger();