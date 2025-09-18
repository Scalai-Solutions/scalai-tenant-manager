const redis = require('redis');
const config = require('../../config/config');
const Logger = require('../utils/logger');

class RedisService {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 1000;
  }

  async connect() {
    try {
      // Create Redis client with configuration
      if (config.redis.url) {
        // Use REDIS_URL directly if available - disable SSL verification for Heroku Redis
        this.client = redis.createClient({
          url: config.redis.url,
          socket: {
            tls: true,
            rejectUnauthorized: false
          }
        });
      } else {
        // Fall back to individual host/port/password
        this.client = redis.createClient({
          host: config.redis.host,
          port: config.redis.port,
          password: config.redis.password,
          db: config.redis.db,
          socket: {
            tls: true,
            rejectUnauthorized: false
          }
        });
      }

      // Set up event handlers
      this.client.on('connect', () => {
        Logger.info('Redis client connected');
        this.isConnected = true;
        this.reconnectAttempts = 0;
      });

      this.client.on('ready', () => {
        Logger.info('Redis client ready');
        this.isConnected = true;
      });

      this.client.on('error', (err) => {
        Logger.error('Redis client error:', err);
        this.isConnected = false;
      });

      this.client.on('end', () => {
        Logger.warn('Redis client connection ended');
        this.isConnected = false;
      });

      this.client.on('reconnecting', () => {
        Logger.info('Redis client reconnecting...');
        this.reconnectAttempts++;
      });

      // Connect to Redis
      await this.client.connect();
      
      // Test connection
      await this.client.ping();
      Logger.info('Redis connection established successfully');
      
    } catch (error) {
      Logger.error('Failed to connect to Redis:', error);
      this.isConnected = false;
      
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        Logger.info(`Retrying Redis connection in ${this.reconnectDelay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        setTimeout(() => this.connect(), this.reconnectDelay);
      } else {
        Logger.error('Max reconnection attempts reached, giving up');
      }
    }
  }

  async disconnect() {
    if (this.client && this.isConnected) {
      await this.client.quit();
      this.isConnected = false;
      Logger.info('Redis client disconnected');
    }
  }

  async set(key, value, ttl = null) {
    if (!this.isConnected) {
      throw new Error('Redis client not connected');
    }
    
    try {
      if (ttl) {
        await this.client.setEx(key, ttl, JSON.stringify(value));
      } else {
        await this.client.set(key, JSON.stringify(value));
      }
      return true;
    } catch (error) {
      Logger.error('Redis set error:', error);
      throw error;
    }
  }

  async get(key) {
    if (!this.isConnected) {
      throw new Error('Redis client not connected');
    }
    
    try {
      const value = await this.client.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      Logger.error('Redis get error:', error);
      throw error;
    }
  }

  async del(key) {
    if (!this.isConnected) {
      throw new Error('Redis client not connected');
    }
    
    try {
      await this.client.del(key);
      return true;
    } catch (error) {
      Logger.error('Redis del error:', error);
      throw error;
    }
  }

  async exists(key) {
    if (!this.isConnected) {
      throw new Error('Redis client not connected');
    }
    
    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      Logger.error('Redis exists error:', error);
      throw error;
    }
  }

  async expire(key, seconds) {
    if (!this.isConnected) {
      throw new Error('Redis client not connected');
    }
    
    try {
      await this.client.expire(key, seconds);
      return true;
    } catch (error) {
      Logger.error('Redis expire error:', error);
      throw error;
    }
  }

  // Cache specific methods
  async cacheSubaccount(subaccountId, data, ttl = 3600) {
    const key = `${config.redis.prefixes.subaccount}${subaccountId}`;
    return await this.set(key, data, ttl);
  }

  async getCachedSubaccount(subaccountId) {
    const key = `${config.redis.prefixes.subaccount}${subaccountId}`;
    return await this.get(key);
  }

  async invalidateSubaccount(subaccountId) {
    const key = `${config.redis.prefixes.subaccount}${subaccountId}`;
    return await this.del(key);
  }

  async cacheUserSubaccounts(userId, data, ttl = 3600) {
    const key = `${config.redis.prefixes.userSubaccount}${userId}`;
    return await this.set(key, data, ttl);
  }

  async getCachedUserSubaccounts(userId) {
    const key = `${config.redis.prefixes.userSubaccount}${userId}`;
    return await this.get(key);
  }

  async invalidateUserSubaccounts(userId) {
    const key = `${config.redis.prefixes.userSubaccount}${userId}`;
    return await this.del(key);
  }

  async cachePermissions(userId, subaccountId, permissions, ttl = 3600) {
    const key = `permissions:${userId}:${subaccountId}`;
    return await this.set(key, permissions, ttl);
  }

  async getCachedPermissions(userId, subaccountId) {
    const key = `permissions:${userId}:${subaccountId}`;
    return await this.get(key);
  }

  async invalidatePermissions(userId, subaccountId) {
    const key = `permissions:${userId}:${subaccountId}`;
    return await this.del(key);
  }

  // Health check
  async ping() {
    if (!this.isConnected) {
      throw new Error('Redis client not connected');
    }
    
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch (error) {
      Logger.error('Redis ping failed:', error);
      throw error;
    }
  }
}

module.exports = RedisService;
