const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');
const config = require('../../config/config');
const Logger = require('../utils/logger');
const redisManager = require('../services/redisManager');
const MemoryRateLimitStore = require('./memoryStore');

// Get Redis service instance
const redisService = redisManager.getRedisService();

// Hybrid rate limit store that uses Redis when available, memory as fallback
class HybridRateLimitStore {
  constructor(options = {}) {
    this.prefix = options.prefix || 'rate_limit:';
    this.windowMs = options.windowMs || 60000;
    this.memoryStore = new MemoryRateLimitStore(options);
  }

  async incr(key) {
    try {
      // Try Redis first if connected
      if (redisService.isConnected) {
        try {
          const redisKey = `${this.prefix}${key}`;
          const windowSeconds = Math.ceil(this.windowMs / 1000);
          
          const result = await redisService.incrementRateLimit(redisKey, windowSeconds, Date.now());
          
          Logger.debug('Using Redis rate limit store', { key: redisKey, current: result.current });
          
          return {
            totalHits: result.current,
            totalTime: Date.now(),
            resetTime: new Date(Date.now() + this.windowMs)
          };
        } catch (redisError) {
          Logger.warn('Redis rate limit failed, falling back to memory', { 
            error: redisError.message, 
            key 
          });
          // Fall through to memory store
        }
      }

      // Use memory store as fallback
      Logger.debug('Using memory rate limit store', { key, reason: 'Redis unavailable' });
      return await this.memoryStore.incr(key);

    } catch (error) {
      Logger.error('Rate limit store error', { 
        error: error.message, 
        key,
        stack: error.stack 
      });
      // Final fallback - allow request
      return {
        totalHits: 1,
        totalTime: Date.now(),
        resetTime: new Date(Date.now() + this.windowMs)
      };
    }
  }

  async decrement(key) {
    // Delegate to memory store for consistency
    return await this.memoryStore.decrement(key);
  }

  async resetAll() {
    Logger.warn('Rate limit resetAll called');
    await this.memoryStore.resetAll();
  }

  // Get stats from both stores
  getStats() {
    return {
      redis: {
        connected: redisService.isConnected,
        status: redisService.isConnected ? 'active' : 'unavailable'
      },
      memory: this.memoryStore.getStats()
    };
  }
}

// General rate limiter
const generalLimiter = rateLimit({
  windowMs: config.rateLimiting.windowMs,
  max: config.rateLimiting.max,
  standardHeaders: config.rateLimiting.standardHeaders,
  legacyHeaders: config.rateLimiting.legacyHeaders,
  store: new HybridRateLimitStore({
    prefix: 'general:',
    windowMs: config.rateLimiting.windowMs
  }),
  keyGenerator: (req) => {
    // Use IP address as default key
    return req.ip;
  },
  handler: (req, res) => {
    Logger.security('Rate limit exceeded', 'medium', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      endpoint: req.originalUrl,
      limit: config.rateLimiting.max
    });

    res.status(429).json({
      success: false,
      message: 'Too many requests, please try again later',
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfter: Math.ceil(config.rateLimiting.windowMs / 1000)
    });
  }
});

// Per-user rate limiter
const userLimiter = rateLimit({
  windowMs: config.rateLimiting.perUser.windowMs,
  max: config.rateLimiting.perUser.max,
  standardHeaders: true,
  legacyHeaders: false,
  store: new HybridRateLimitStore({
    prefix: 'user:',
    windowMs: config.rateLimiting.perUser.windowMs
  }),
  keyGenerator: (req) => {
    // Use user ID if authenticated, otherwise IP
    return req.user ? `user:${req.user.id}` : `ip:${req.ip}`;
  },
  skip: (req) => {
    // Skip rate limiting for super admins
    return req.user && req.user.role === 'super_admin';
  },
  handler: (req, res) => {
    Logger.security('User rate limit exceeded', 'medium', {
      userId: req.user?.id,
      ip: req.ip,
      endpoint: req.originalUrl,
      limit: config.rateLimiting.perUser.max
    });

    res.status(429).json({
      success: false,
      message: 'Too many requests from this user',
      code: 'USER_RATE_LIMIT_EXCEEDED',
      retryAfter: Math.ceil(config.rateLimiting.perUser.windowMs / 1000)
    });
  }
});

// Admin endpoints rate limiter (higher limits)
const adminLimiter = rateLimit({
  windowMs: config.rateLimiting.admin.windowMs,
  max: config.rateLimiting.admin.max,
  standardHeaders: true,
  legacyHeaders: false,
  store: new HybridRateLimitStore({
    prefix: 'admin:',
    windowMs: config.rateLimiting.admin.windowMs
  }),
  keyGenerator: (req) => {
    return req.user ? `admin:${req.user.id}` : `ip:${req.ip}`;
  },
  handler: (req, res) => {
    Logger.security('Admin rate limit exceeded', 'high', {
      userId: req.user?.id,
      ip: req.ip,
      endpoint: req.originalUrl,
      limit: config.rateLimiting.admin.max
    });

    res.status(429).json({
      success: false,
      message: 'Too many admin requests',
      code: 'ADMIN_RATE_LIMIT_EXCEEDED',
      retryAfter: Math.ceil(config.rateLimiting.admin.windowMs / 1000)
    });
  }
});

// Slow down middleware for progressive delays
const speedLimiter = slowDown({
  windowMs: 60 * 1000, // 1 minute
  delayAfter: 50, // Allow 50 requests per minute without delay
  delayMs: () => 100, // Add 100ms delay per request after delayAfter
  maxDelayMs: 2000, // Maximum delay of 2 seconds
  store: new HybridRateLimitStore({
    prefix: 'slow:',
    windowMs: 60 * 1000
  }),
  keyGenerator: (req) => {
    return req.user ? `user:${req.user.id}` : `ip:${req.ip}`;
  }
});

// Subaccount-specific rate limiter
const subaccountLimiter = (maxRequests = 100, windowMs = 60000) => {
  return rateLimit({
    windowMs,
    max: maxRequests,
    store: new HybridRateLimitStore({
      prefix: 'subaccount:',
      windowMs
    }),
    keyGenerator: (req) => {
      const subaccountId = req.params.subaccountId || req.body.subaccountId;
      return `${req.user?.id}:${subaccountId}`;
    },
    handler: (req, res) => {
      const subaccountId = req.params.subaccountId || req.body.subaccountId;
      
      Logger.security('Subaccount rate limit exceeded', 'medium', {
        userId: req.user?.id,
        subaccountId,
        ip: req.ip,
        endpoint: req.originalUrl,
        limit: maxRequests
      });

      res.status(429).json({
        success: false,
        message: 'Too many requests for this subaccount',
        code: 'SUBACCOUNT_RATE_LIMIT_EXCEEDED',
        subaccountId,
        retryAfter: Math.ceil(windowMs / 1000)
      });
    }
  });
};

// Create rate limiter
const createRateLimiter = (options) => {
  return rateLimit({
    ...options,
    store: new HybridRateLimitStore({
      prefix: options.prefix || 'custom:',
      windowMs: options.windowMs
    }),
    handler: (req, res) => {
      Logger.security('Custom rate limit exceeded', 'medium', {
        userId: req.user?.id,
        ip: req.ip,
        endpoint: req.originalUrl,
        limit: options.max,
        type: options.type || 'custom'
      });

      res.status(429).json({
        success: false,
        message: options.message || 'Rate limit exceeded',
        code: options.code || 'RATE_LIMIT_EXCEEDED',
        retryAfter: Math.ceil(options.windowMs / 1000)
      });
    }
  });
};

// Burst protection for sensitive operations
const burstProtection = createRateLimiter({
  windowMs: 10 * 1000, // 10 seconds
  max: 5, // Only 5 requests per 10 seconds
  prefix: 'burst:',
  type: 'burst_protection',
  message: 'Too many rapid requests for sensitive operation',
  code: 'BURST_PROTECTION_TRIGGERED'
});

// Login attempt limiter (for auth endpoints)
const loginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per 15 minutes per IP
  prefix: 'login:',
  type: 'login_attempts',
  message: 'Too many login attempts, please try again later',
  code: 'LOGIN_RATE_LIMIT_EXCEEDED',
  keyGenerator: (req) => `login:${req.ip}`
});

// Password reset limiter
const passwordResetLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 password reset attempts per hour per IP
  prefix: 'password_reset:',
  type: 'password_reset',
  message: 'Too many password reset attempts',
  code: 'PASSWORD_RESET_RATE_LIMIT_EXCEEDED',
  keyGenerator: (req) => `reset:${req.ip}`
});

// Dynamic rate limiter based on user role
const dynamicUserLimiter = (req, res, next) => {
  let maxRequests = config.rateLimiting.perUser.max;
  let windowMs = config.rateLimiting.perUser.windowMs;

  // Adjust limits based on user role
  if (req.user) {
    switch (req.user.role) {
      case 'super_admin':
        return next(); // No rate limiting for super admins
      case 'admin':
        maxRequests = config.rateLimiting.admin.max;
        windowMs = config.rateLimiting.admin.windowMs;
        break;
      case 'user':
        // Use default limits
        break;
    }
  }

  const limiter = createRateLimiter({
    windowMs,
    max: maxRequests,
    prefix: 'dynamic:',
    type: 'dynamic_user',
    keyGenerator: (req) => req.user ? `user:${req.user.id}` : `ip:${req.ip}`
  });

  limiter(req, res, next);
};

// Rate limit status endpoint
const getRateLimitStatus = async (req, res) => {
  try {
    const userId = req.user?.id;
    const ip = req.ip;
    
    const keys = [
      `general:${ip}`,
      userId ? `user:user:${userId}` : null,
      `admin:admin:${userId}`,
      `slow:user:${userId}` || `slow:ip:${ip}`
    ].filter(Boolean);

    const status = {};
    
    for (const key of keys) {
      try {
        const ttl = await redisService.client.ttl(key);
        const count = await redisService.client.get(key);
        
        status[key] = {
          count: parseInt(count) || 0,
          ttl,
          resetAt: ttl > 0 ? new Date(Date.now() + (ttl * 1000)) : null
        };
      } catch (error) {
        status[key] = { error: error.message };
      }
    }

    res.json({
      success: true,
      data: {
        status,
        limits: {
          general: config.rateLimiting.max,
          user: config.rateLimiting.perUser.max,
          admin: config.rateLimiting.admin.max
        }
      }
    });
  } catch (error) {
    Logger.error('Failed to get rate limit status', {
      error: error.message,
      userId: req.user?.id
    });

    res.status(500).json({
      success: false,
      message: 'Failed to get rate limit status'
    });
  }
};

module.exports = {
  generalLimiter,
  userLimiter,
  adminLimiter,
  speedLimiter,
  subaccountLimiter,
  createRateLimiter,
  burstProtection,
  loginLimiter,
  passwordResetLimiter,
  dynamicUserLimiter,
  getRateLimitStatus,
  HybridRateLimitStore
}; 