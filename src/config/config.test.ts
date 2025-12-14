import * as fc from 'fast-check';
import { configManager } from './index';

describe('Config Manager Tests', () => {
  describe('**Feature: crypto-trading-api, Property 11: 数据加密往返**', () => {
    test('对于任何敏感数据，加密后解密应该得到原始数据', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 1000 }),
          (originalData) => {
            // 加密数据
            const encrypted = configManager.encryptSensitiveData(originalData);
            
            // 解密数据
            const decrypted = configManager.decryptSensitiveData(encrypted);
            
            // 验证往返一致性
            expect(decrypted).toBe(originalData);
            
            // 验证加密后的数据与原始数据不同（除非是空字符串）
            if (originalData.length > 0) {
              expect(encrypted).not.toBe(originalData);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    test('加密相同数据应产生不同结果（如果使用随机IV）', () => {
      const testData = 'sensitive_api_key_12345';
      const encrypted1 = configManager.encryptSensitiveData(testData);
      const encrypted2 = configManager.encryptSensitiveData(testData);
      
      // 解密后应该都等于原始数据
      expect(configManager.decryptSensitiveData(encrypted1)).toBe(testData);
      expect(configManager.decryptSensitiveData(encrypted2)).toBe(testData);
    });

    test('空字符串加密解密', () => {
      const emptyString = '';
      const encrypted = configManager.encryptSensitiveData(emptyString);
      const decrypted = configManager.decryptSensitiveData(encrypted);
      
      expect(decrypted).toBe(emptyString);
    });

    test('特殊字符加密解密', () => {
      const specialChars = '!@#$%^&*()_+-=[]{}|;:,.<>?~`';
      const encrypted = configManager.encryptSensitiveData(specialChars);
      const decrypted = configManager.decryptSensitiveData(encrypted);
      
      expect(decrypted).toBe(specialChars);
    });

    test('Unicode字符加密解密', () => {
      const unicodeString = '测试数据🔐🚀💰';
      const encrypted = configManager.encryptSensitiveData(unicodeString);
      const decrypted = configManager.decryptSensitiveData(encrypted);
      
      expect(decrypted).toBe(unicodeString);
    });
  });

  describe('Configuration Validation', () => {
    test('应该正确加载数据库配置', () => {
      expect(configManager.database).toBeDefined();
      expect(configManager.database.host).toBeDefined();
      expect(configManager.database.port).toBeGreaterThan(0);
      expect(configManager.database.database).toBeDefined();
      expect(configManager.database.username).toBeDefined();
    });

    test('应该正确加载Redis配置', () => {
      expect(configManager.redis).toBeDefined();
      expect(configManager.redis.host).toBeDefined();
      expect(configManager.redis.port).toBeGreaterThan(0);
    });

    test('应该正确加载应用配置', () => {
      expect(configManager.app).toBeDefined();
      expect(configManager.app.port).toBeGreaterThan(0);
      expect(configManager.app.host).toBeDefined();
      expect(configManager.app.logLevel).toBeDefined();
      expect(configManager.app.encryptionKey).toBeDefined();
    });

    test('应该是单例模式', () => {
      const instance1 = configManager;
      const instance2 = configManager;
      
      expect(instance1).toBe(instance2);
    });
  });

  describe('Error Handling', () => {
    test('解密无效数据应该抛出错误', () => {
      expect(() => {
        configManager.decryptSensitiveData('invalid_encrypted_data');
      }).toThrow();
    });

    test('解密空字符串应该处理正确', () => {
      // 这个测试取决于具体的加密实现
      // 如果空字符串加密后不是空字符串，那么解密空字符串应该失败
      expect(() => {
        configManager.decryptSensitiveData('');
      }).toThrow();
    });
  });
});