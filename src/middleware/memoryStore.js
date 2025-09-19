const Logger = require('../utils/logger');

class MemoryRateLimitStore {
  constructor(options = {}) {
    this.prefix = options.prefix || 'rate_limit:';
    this.windowMs = options.windowMs || 60000;
    this.store = new Map();
    this.cleanupInterval = null;
    
    // Clean up expired entries every minute
    this.startCleanup();
  }

  startCleanup() {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, data] of this.store.entries()) {
        if (data.resetTime && data.resetTime < now) {
          this.store.delete(key);
        }
      }
    }, 60000); // Clean up every minute
  }

  stopCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  async get(key) {
    try {
      const storeKey = `${this.prefix}${key}`;
      const entry = this.store.get(storeKey);
      const now = Date.now();

      if (!entry || entry.resetTime < now) {
        return undefined;
      }

      return {
        totalHits: entry.totalHits,
        resetTime: new Date(entry.resetTime)
      };
    } catch (error) {
      Logger.error('Memory rate limit store get error', { error: error.message, key });
      return undefined;
    }
  }

  async incr(key) {
    try {
      const storeKey = `${this.prefix}${key}`;
      const now = Date.now();
      const resetTime = now + this.windowMs;

      let entry = this.store.get(storeKey);

      if (!entry || entry.resetTime < now) {
        // Create new entry or reset expired entry
        entry = {
          totalHits: 1,
          resetTime,
          totalTime: now
        };
      } else {
        // Increment existing entry
        entry.totalHits++;
        entry.totalTime = now;
      }

      this.store.set(storeKey, entry);

      Logger.debug('Memory rate limit store incr', {
        key: storeKey,
        totalHits: entry.totalHits,
        resetTime: new Date(entry.resetTime)
      });

      return {
        totalHits: entry.totalHits,
        resetTime: new Date(entry.resetTime)
      };
    } catch (error) {
      Logger.error('Memory rate limit store error', { error: error.message, key });
      // Return safe default
      return {
        totalHits: 1,
        resetTime: new Date(Date.now() + this.windowMs)
      };
    }
  }

  async decrement(key) {
    // Not implemented for memory store - entries expire naturally
    return;
  }

  async resetKey(key) {
    try {
      const storeKey = `${this.prefix}${key}`;
      this.store.delete(storeKey);
      Logger.debug('Memory rate limit store key reset', { key: storeKey });
    } catch (error) {
      Logger.error('Memory rate limit store resetKey error', { error: error.message, key });
    }
  }

  async resetAll() {
    Logger.warn('Memory rate limit store resetAll called');
    this.store.clear();
  }

  // Get current stats for debugging
  getStats() {
    return {
      totalKeys: this.store.size,
      keys: Array.from(this.store.keys()),
      memoryUsage: process.memoryUsage()
    };
  }
}

module.exports = MemoryRateLimitStore; 