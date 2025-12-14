import { config } from 'dotenv';
import { createHash, createCipher, createDecipher } from 'crypto';

config();

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  maxConnections: number;
}

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db: number;
}

export interface ExchangeConfig {
  binance?: {
    apiKey: string;
    secret: string;
    sandbox: boolean;
  };
  okx?: {
    apiKey: string;
    secret: string;
    passphrase: string;
    sandbox: boolean;
  };
}

export interface AppConfig {
  port: number;
  host: string;
  logLevel: string;
  nodeEnv: string;
  encryptionKey: string;
  jwtSecret: string;
  rateLimitWindow: number;
  rateLimitMax: number;
}

class ConfigManager {
  private static instance: ConfigManager;
  
  public readonly database: DatabaseConfig;
  public readonly redis: RedisConfig;
  public readonly exchanges: ExchangeConfig;
  public readonly app: AppConfig;

  private constructor() {
    this.validateRequiredEnvVars();
    
    this.database = {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'trading',
      username: process.env.DB_USER || 'trading_user',
      password: process.env.DB_PASSWORD || '',
      maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS || '10'),
    };

    this.redis = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || '0'),
    };

    this.exchanges = {
      binance: process.env.BINANCE_API_KEY ? {
        apiKey: process.env.BINANCE_API_KEY,
        secret: process.env.BINANCE_SECRET || '',
        sandbox: process.env.BINANCE_SANDBOX === 'true',
      } : undefined,
      okx: process.env.OKX_API_KEY ? {
        apiKey: process.env.OKX_API_KEY,
        secret: process.env.OKX_SECRET || '',
        passphrase: process.env.OKX_PASSPHRASE || '',
        sandbox: process.env.OKX_SANDBOX === 'true',
      } : undefined,
    };

    this.app = {
      port: parseInt(process.env.API_PORT || '53000'),
      host: process.env.API_HOST || '0.0.0.0',
      logLevel: process.env.LOG_LEVEL || 'info',
      nodeEnv: process.env.NODE_ENV || 'development',
      encryptionKey: process.env.ENCRYPTION_KEY || this.generateDefaultKey(),
      jwtSecret: process.env.JWT_SECRET || this.generateDefaultKey(),
      rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW || '60000'),
      rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '100'),
    };
  }

  public static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  private validateRequiredEnvVars(): void {
    const required = ['DB_PASSWORD'];
    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
  }

  private generateDefaultKey(): string {
    return createHash('sha256').update(Date.now().toString()).digest('hex');
  }

  public encryptSensitiveData(data: string): string {
    const cipher = createCipher('aes-256-cbc', this.app.encryptionKey);
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return encrypted;
  }

  public decryptSensitiveData(encryptedData: string): string {
    const decipher = createDecipher('aes-256-cbc', this.app.encryptionKey);
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  public reload(): void {
    config({ override: true });
    // 重新创建实例以加载新配置
    ConfigManager.instance = new ConfigManager();
  }
}

export const configManager = ConfigManager.getInstance();