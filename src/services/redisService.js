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
    if (!this.isConnected) {
      return null;
    }

    try {
      // Invalidate the specific subaccount cache
      const key = `${config.redis.prefixes.subaccount}${subaccountId}`;
      await this.del(key);

      // Also invalidate all global admin caches that might contain this subaccount
      const pattern = `user_subaccounts:*:global_admin:*`;
      const keys = [];
      let cursor = '0';
      
      do {
        const reply = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = reply[0];
        keys.push(...reply[1]);
      } while (cursor !== '0');
      
      if (keys.length > 0) {
        await this.client.del(...keys);
        Logger.debug('Invalidated global admin caches for subaccount', { 
          subaccountId, 
          keysDeleted: keys.length 
        });
      }

      return { subaccountKey: key, globalAdminKeys: keys.length };
    } catch (error) {
      Logger.warn('Failed to invalidate subaccount cache', { 
        subaccountId, 
        error: error.message 
      });
      return null;
    }
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
    if (!this.isConnected) {
      return null;
    }

    try {
      // Invalidate all cache keys matching the pattern for this user
      // This includes both regular user and global admin caches with any query params
      const pattern = `user_subaccounts:${userId}:*`;
      
      // Use SCAN to find all matching keys (safer than KEYS in production)
      const keys = [];
      let cursor = '0';
      
      do {
        const reply = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = reply[0];
        keys.push(...reply[1]);
      } while (cursor !== '0');
      
      // Delete all found keys
      if (keys.length > 0) {
        await this.client.del(...keys);
        Logger.debug('Invalidated user subaccount caches', { userId, keysDeleted: keys.length });
      }
      
      return keys.length;
    } catch (error) {
      Logger.warn('Failed to invalidate user subaccount caches', { 
        userId, 
        error: error.message 
      });
      return null;
    }
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

  // Rate limiting methods
  async incrementRateLimit(key, windowSeconds, currentTimestamp = Date.now()) {
    if (!this.isConnected) {
      throw new Error('Redis client not connected');
    }
    
    try {
      // Use Redis INCR with EXPIRE for atomic operation
      const multi = this.client.multi();
      multi.incr(key);
      multi.expire(key, windowSeconds);
      
      const results = await multi.exec();
      const current = results[0]; // INCR result (fixed from results[0][1])
      
      return {
        current,
        remaining: Math.max(0, windowSeconds - current),
        resetTime: currentTimestamp + (windowSeconds * 1000)
      };
    } catch (error) {
      Logger.error('Redis incrementRateLimit error:', error);
      throw error;
    }
  }

  async getRateLimit(key) {
    if (!this.isConnected) {
      throw new Error('Redis client not connected');
    }
    
    try {
      const multi = this.client.multi();
      multi.get(key);
      multi.ttl(key);
      
      const results = await multi.exec();
      const current = parseInt(results[0][1]) || 0;
      const ttl = results[1][1];
      
      return {
        current,
        ttl,
        resetTime: ttl > 0 ? Date.now() + (ttl * 1000) : null
      };
    } catch (error) {
      Logger.error('Redis getRateLimit error:', error);
      throw error;
    }
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
