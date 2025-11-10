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
        
        // Handle Redis v4 response format: [cursor, keys[]]
        if (!reply || !Array.isArray(reply) || reply.length < 2) {
          Logger.warn('Unexpected SCAN reply format in invalidateSubaccount', { reply, pattern });
          break;
        }
        
        cursor = reply[0];
        const foundKeys = reply[1];
        
        if (Array.isArray(foundKeys)) {
          keys.push(...foundKeys);
        } else {
          Logger.warn('SCAN returned non-array keys in invalidateSubaccount', { foundKeys, reply });
          break;
        }
      } while (cursor !== '0' && cursor !== 0);
      
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
        
        // Handle Redis v4 response format: [cursor, keys[]]
        if (!reply || !Array.isArray(reply) || reply.length < 2) {
          Logger.warn('Unexpected SCAN reply format in invalidateUserSubaccounts', { reply, pattern });
          break;
        }
        
        cursor = reply[0];
        const foundKeys = reply[1];
        
        if (Array.isArray(foundKeys)) {
          keys.push(...foundKeys);
        } else {
          Logger.warn('SCAN returned non-array keys in invalidateUserSubaccounts', { foundKeys, reply });
          break;
        }
      } while (cursor !== '0' && cursor !== 0);
      
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

  async invalidateAllUserSubaccounts() {
    if (!this.isConnected) {
      Logger.warn('Redis not connected, cannot invalidate user subaccount caches');
      return null;
    }

    try {
      // Invalidate ALL user subaccount caches (for all users and all query params)
      // This is used when a new subaccount is created to ensure all caches are cleared
      const pattern = `user_subaccounts:*`;
      
      Logger.debug('Starting to invalidate all user subaccount caches', { pattern });
      
      // Use SCAN to find all matching keys (safer than KEYS in production)
      const keys = [];
      let cursor = '0';
      let scanCount = 0;
      
      do {
        const reply = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        
        // Handle Redis v4 response format: [cursor, keys[]]
        if (!reply || !Array.isArray(reply) || reply.length < 2) {
          Logger.warn('Unexpected SCAN reply format', { reply, pattern });
          break;
        }
        
        cursor = reply[0];
        const foundKeys = reply[1];
        
        // Ensure foundKeys is an array
        if (Array.isArray(foundKeys)) {
          keys.push(...foundKeys);
          scanCount++;
          Logger.debug('SCAN iteration', { 
            cursor, 
            keysFound: foundKeys.length, 
            totalKeys: keys.length,
            iteration: scanCount
          });
        } else {
          Logger.warn('SCAN returned non-array keys', { foundKeys, reply, pattern });
          break;
        }
      } while (cursor !== '0' && cursor !== 0);
      
      Logger.info('Found user subaccount cache keys to invalidate', { 
        totalKeys: keys.length,
        keys: keys.slice(0, 10) // Log first 10 keys for debugging
      });
      
      // Delete all found keys in batches (Redis DEL can handle multiple keys)
      if (keys.length > 0) {
        // Delete in batches of 100 to avoid issues with very large key sets
        const batchSize = 100;
        let deletedCount = 0;
        
        for (let i = 0; i < keys.length; i += batchSize) {
          const batch = keys.slice(i, i + batchSize);
          const deleted = await this.client.del(batch);
          deletedCount += deleted;
          Logger.debug('Deleted batch of cache keys', { 
            batchNumber: Math.floor(i / batchSize) + 1,
            batchSize: batch.length,
            deletedInBatch: deleted
          });
        }
        
        Logger.info('Invalidated all user subaccount caches', { 
          keysFound: keys.length,
          keysDeleted: deletedCount,
          pattern 
        });
        
        return deletedCount;
      } else {
        Logger.debug('No user subaccount cache keys found to invalidate', { pattern });
        return 0;
      }
    } catch (error) {
      Logger.error('Failed to invalidate all user subaccount caches', { 
        error: error.message,
        stack: error.stack,
        pattern: 'user_subaccounts:*'
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

  async invalidateSubaccountUsers(subaccountId) {
    if (!this.isConnected) {
      return null;
    }

    try {
      // Invalidate all subaccount users cache keys for this subaccount
      // Pattern: subaccount_users:${subaccountId}:*
      const pattern = `subaccount_users:${subaccountId}:*`;
      const keys = [];
      let cursor = '0';
      
      do {
        const reply = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        
        // Handle different Redis client response formats
        let foundKeys = [];
        let nextCursor = '0';
        
        if (Array.isArray(reply) && reply.length >= 2) {
          // Format: [cursor, keys[]]
          nextCursor = reply[0];
          foundKeys = Array.isArray(reply[1]) ? reply[1] : [];
        } else if (reply && typeof reply === 'object') {
          // Format: { cursor: number, keys: string[] }
          if (reply.cursor !== undefined && reply.keys !== undefined) {
            nextCursor = reply.cursor;
            foundKeys = Array.isArray(reply.keys) ? reply.keys : [];
          } else {
            Logger.warn('Unexpected SCAN reply format in invalidateSubaccountUsers', { reply, pattern });
            break;
          }
        } else {
          Logger.warn('Unexpected SCAN reply format in invalidateSubaccountUsers', { reply, pattern });
          break;
        }
        
        if (foundKeys.length > 0) {
          keys.push(...foundKeys);
        }
        
        cursor = nextCursor;
      } while (cursor !== '0' && cursor !== 0);
      
      // Delete all found keys
      if (keys.length > 0) {
        await this.client.del(...keys);
        Logger.debug('Invalidated subaccount users cache', { subaccountId, keysDeleted: keys.length });
      }
      
      return keys.length;
    } catch (error) {
      Logger.warn('Failed to invalidate subaccount users cache', { 
        subaccountId, 
        error: error.message 
      });
      return null;
    }
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
