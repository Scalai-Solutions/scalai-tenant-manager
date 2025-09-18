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
      this.client = redis.createClient({
        host: config.redis.host,
        port: config.redis.port,
        password: config.redis.password,
        db: config.redis.db,
        retryDelayOnFailover: 100,
        enableReadyCheck: true,
        maxRetriesPerRequest: 3,
        lazyConnect: true,
        keepAlive: true,
        family: 4
      });

      // Event handlers
      this.client.on('connect', () => {
        Logger.info('Redis client connecting...');
      });

      this.client.on('ready', () => {
        Logger.info('Redis client connected and ready');
        this.isConnected = true;
        this.reconnectAttempts = 0;
      });

      this.client.on('error', (error) => {
        Logger.error('Redis client error:', { error: error.message });
        this.isConnected = false;
      });

      this.client.on('end', () => {
        Logger.warn('Redis client connection ended');
        this.isConnected = false;
      });

      this.client.on('reconnecting', () => {
        this.reconnectAttempts++;
        Logger.info(`Redis client reconnecting... (attempt ${this.reconnectAttempts})`);
        
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          Logger.error('Max reconnection attempts reached, giving up');
          this.client.disconnect();
        }
      });

      // Connect to Redis
      await this.client.connect();
      
      // Test connection
      await this.ping();
      
      Logger.info('Redis service initialized successfully');
      return true;
    } catch (error) {
      Logger.error('Failed to connect to Redis:', { error: error.message });
      this.isConnected = false;
      throw error;
    }
  }

  async disconnect() {
    try {
      if (this.client && this.isConnected) {
        await this.client.disconnect();
        Logger.info('Redis client disconnected');
      }
    } catch (error) {
      Logger.error('Error disconnecting Redis client:', { error: error.message });
    }
  }

  async ping() {
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch (error) {
      Logger.error('Redis ping failed:', { error: error.message });
      return false;
    }
  }

  // Generic cache methods
  async set(key, value, ttlSeconds = config.redis.ttl) {
    try {
      if (!this.isConnected) {
        Logger.warn('Redis not connected, skipping cache set');
        return false;
      }

      const serializedValue = JSON.stringify(value);
      if (ttlSeconds) {
        await this.client.setEx(key, ttlSeconds, serializedValue);
      } else {
        await this.client.set(key, serializedValue);
      }
      
      Logger.debug('Cache set successful:', { key, ttl: ttlSeconds });
      return true;
    } catch (error) {
      Logger.error('Cache set failed:', { key, error: error.message });
      return false;
    }
  }

  async get(key) {
    try {
      if (!this.isConnected) {
        Logger.warn('Redis not connected, cache miss');
        return null;
      }

      const value = await this.client.get(key);
      if (value === null) {
        Logger.debug('Cache miss:', { key });
        return null;
      }

      const parsedValue = JSON.parse(value);
      Logger.debug('Cache hit:', { key });
      return parsedValue;
    } catch (error) {
      Logger.error('Cache get failed:', { key, error: error.message });
      return null;
    }
  }

  async del(key) {
    try {
      if (!this.isConnected) {
        return false;
      }

      const result = await this.client.del(key);
      Logger.debug('Cache delete:', { key, deleted: result > 0 });
      return result > 0;
    } catch (error) {
      Logger.error('Cache delete failed:', { key, error: error.message });
      return false;
    }
  }

  async exists(key) {
    try {
      if (!this.isConnected) {
        return false;
      }

      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      Logger.error('Cache exists check failed:', { key, error: error.message });
      return false;
    }
  }

  async expire(key, ttlSeconds) {
    try {
      if (!this.isConnected) {
        return false;
      }

      const result = await this.client.expire(key, ttlSeconds);
      return result === 1;
    } catch (error) {
      Logger.error('Cache expire failed:', { key, error: error.message });
      return false;
    }
  }

  // Subaccount-specific cache methods
  async cacheSubaccount(subaccountId, subaccountData, ttlSeconds = 3600) {
    const key = `${config.redis.prefixes.subaccount}${subaccountId}`;
    return await this.set(key, subaccountData, ttlSeconds);
  }

  async getSubaccount(subaccountId) {
    const key = `${config.redis.prefixes.subaccount}${subaccountId}`;
    return await this.get(key);
  }

  async invalidateSubaccount(subaccountId) {
    const key = `${config.redis.prefixes.subaccount}${subaccountId}`;
    return await this.del(key);
  }

  // User-subaccount relationship cache methods
  async cacheUserSubaccounts(userId, subaccounts, ttlSeconds = 1800) {
    const key = `${config.redis.prefixes.userSubaccount}${userId}`;
    return await this.set(key, subaccounts, ttlSeconds);
  }

  async getUserSubaccounts(userId) {
    const key = `${config.redis.prefixes.userSubaccount}${userId}`;
    return await this.get(key);
  }

  async invalidateUserSubaccounts(userId) {
    const key = `${config.redis.prefixes.userSubaccount}${userId}`;
    return await this.del(key);
  }

  // Permission cache methods
  async cachePermissions(userId, subaccountId, permissions, ttlSeconds = 3600) {
    const key = `${config.redis.prefixes.permissions}${userId}:${subaccountId}`;
    return await this.set(key, permissions, ttlSeconds);
  }

  async getPermissions(userId, subaccountId) {
    const key = `${config.redis.prefixes.permissions}${userId}:${subaccountId}`;
    return await this.get(key);
  }

  async invalidatePermissions(userId, subaccountId) {
    const key = `${config.redis.prefixes.permissions}${userId}:${subaccountId}`;
    return await this.del(key);
  }

  // Session management methods
  async createSession(sessionId, sessionData, ttlSeconds = config.security.sessionTimeout / 1000) {
    const key = `${config.redis.prefixes.session}${sessionId}`;
    return await this.set(key, sessionData, ttlSeconds);
  }

  async getSession(sessionId) {
    const key = `${config.redis.prefixes.session}${sessionId}`;
    return await this.get(key);
  }

  async updateSession(sessionId, sessionData, ttlSeconds) {
    const key = `${config.redis.prefixes.session}${sessionId}`;
    return await this.set(key, sessionData, ttlSeconds);
  }

  async deleteSession(sessionId) {
    const key = `${config.redis.prefixes.session}${sessionId}`;
    return await this.del(key);
  }

  async extendSession(sessionId, ttlSeconds = config.security.sessionTimeout / 1000) {
    const key = `${config.redis.prefixes.session}${sessionId}`;
    return await this.expire(key, ttlSeconds);
  }

  // Bulk operations
  async invalidateUserCache(userId) {
    try {
      if (!this.isConnected) {
        return false;
      }

      const patterns = [
        `${config.redis.prefixes.userSubaccount}${userId}`,
        `${config.redis.prefixes.permissions}${userId}:*`
      ];

      let deleted = 0;
      for (const pattern of patterns) {
        if (pattern.includes('*')) {
          // Use SCAN for pattern matching
          const keys = await this.client.keys(pattern);
          if (keys.length > 0) {
            const result = await this.client.del(...keys);
            deleted += result;
          }
        } else {
          const result = await this.client.del(pattern);
          deleted += result;
        }
      }

      Logger.info('User cache invalidated:', { userId, keysDeleted: deleted });
      return true;
    } catch (error) {
      Logger.error('Failed to invalidate user cache:', { userId, error: error.message });
      return false;
    }
  }

  async invalidateSubaccountCache(subaccountId) {
    try {
      if (!this.isConnected) {
        return false;
      }

      const patterns = [
        `${config.redis.prefixes.subaccount}${subaccountId}`,
        `${config.redis.prefixes.permissions}*:${subaccountId}`
      ];

      let deleted = 0;
      for (const pattern of patterns) {
        if (pattern.includes('*')) {
          const keys = await this.client.keys(pattern);
          if (keys.length > 0) {
            const result = await this.client.del(...keys);
            deleted += result;
          }
        } else {
          const result = await this.client.del(pattern);
          deleted += result;
        }
      }

      Logger.info('Subaccount cache invalidated:', { subaccountId, keysDeleted: deleted });
      return true;
    } catch (error) {
      Logger.error('Failed to invalidate subaccount cache:', { subaccountId, error: error.message });
      return false;
    }
  }

  // Rate limiting support
  async incrementRateLimit(key, windowSeconds, maxRequests) {
    try {
      if (!this.isConnected) {
        return { allowed: true, remaining: maxRequests };
      }

      const multi = this.client.multi();
      multi.incr(key);
      multi.expire(key, windowSeconds);
      
      const results = await multi.exec();
      const currentRequests = results[0];
      
      const remaining = Math.max(0, maxRequests - currentRequests);
      const allowed = currentRequests <= maxRequests;
      
      return { allowed, remaining, current: currentRequests };
    } catch (error) {
      Logger.error('Rate limit check failed:', { key, error: error.message });
      return { allowed: true, remaining: maxRequests };
    }
  }

  // Health check and statistics
  async getStats() {
    try {
      if (!this.isConnected) {
        return { connected: false };
      }

      const info = await this.client.info();
      const memoryUsage = await this.client.memory('usage');
      
      return {
        connected: this.isConnected,
        info: this.parseRedisInfo(info),
        memoryUsage,
        reconnectAttempts: this.reconnectAttempts
      };
    } catch (error) {
      Logger.error('Failed to get Redis stats:', { error: error.message });
      return { connected: false, error: error.message };
    }
  }

  parseRedisInfo(infoString) {
    const info = {};
    const lines = infoString.split('\r\n');
    
    lines.forEach(line => {
      if (line && !line.startsWith('#')) {
        const [key, value] = line.split(':');
        if (key && value) {
          info[key] = value;
        }
      }
    });
    
    return info;
  }

  // Cleanup and maintenance
  async cleanup() {
    try {
      if (!this.isConnected) {
        return false;
      }

      // Clean up expired sessions (Redis handles this automatically, but we can log)
      const sessionKeys = await this.client.keys(`${config.redis.prefixes.session}*`);
      Logger.info('Active sessions:', { count: sessionKeys.length });
      
      return true;
    } catch (error) {
      Logger.error('Cache cleanup failed:', { error: error.message });
      return false;
    }
  }
}

// Singleton instance
const redisService = new RedisService();

module.exports = redisService; 