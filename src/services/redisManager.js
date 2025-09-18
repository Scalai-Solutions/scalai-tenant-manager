const RedisService = require('./redisService');
const Logger = require('../utils/logger');

class RedisManager {
  constructor() {
    if (RedisManager.instance) {
      return RedisManager.instance;
    }

    this.redisService = new RedisService();
    this.isInitialized = false;
    RedisManager.instance = this;
  }

  async initialize() {
    if (this.isInitialized) {
      return this.redisService;
    }

    try {
      await this.redisService.connect();
      this.isInitialized = true;
      Logger.info('Redis manager initialized successfully');
    } catch (error) {
      Logger.warn('Redis manager initialization failed', { error: error.message });
      // Don't throw - allow app to continue without Redis
    }

    return this.redisService;
  }

  getRedisService() {
    return this.redisService;
  }

  async shutdown() {
    if (this.isInitialized && this.redisService) {
      await this.redisService.disconnect();
      this.isInitialized = false;
    }
  }
}

// Create singleton instance
const redisManager = new RedisManager();

module.exports = redisManager; 