// Jest测试环境设置
process.env.NODE_ENV = 'test';
process.env.DB_PASSWORD = 'test_password';
process.env.LOG_LEVEL = 'silent';

// 设置测试超时
jest.setTimeout(10000);