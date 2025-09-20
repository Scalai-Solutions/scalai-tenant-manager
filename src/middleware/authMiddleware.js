const jwt = require('jsonwebtoken');
const config = require('../../config/config');
const Logger = require('../utils/logger');
const redisManager = require('../services/redisManager');
const { v4: uuidv4 } = require('uuid');

// JWT token authentication middleware
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      Logger.security('Missing access token', 'medium', {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        endpoint: req.originalUrl
      });

      return res.status(401).json({
        success: false,
        message: 'Access token required',
        code: 'TOKEN_REQUIRED'
      });
    }

    // Add comprehensive token format validation
    if (!token || typeof token !== 'string' || token.trim() === '') {
      Logger.security('Empty or invalid token format', 'medium', {
        tokenType: typeof token,
        tokenLength: token ? token.length : 0,
        ip: req.ip
      });

      return res.status(403).json({
        success: false,
        message: 'Invalid token format',
        code: 'TOKEN_MALFORMED'
      });
    }

    // JWT should have exactly 3 parts separated by dots
    const tokenParts = token.split('.');
    if (tokenParts.length !== 3) {
      Logger.security('Malformed JWT token structure', 'medium', {
        tokenLength: token.length,
        tokenParts: tokenParts.length,
        ip: req.ip,
        tokenPrefix: token.substring(0, Math.min(10, token.length)) + '...'
      });

      return res.status(403).json({
        success: false,
        message: 'Malformed token structure',
        code: 'TOKEN_MALFORMED'
      });
    }

    // Validate each part is base64url encoded (basic check)
    for (let i = 0; i < tokenParts.length; i++) {
      if (!tokenParts[i] || tokenParts[i].trim() === '') {
        Logger.security('Empty JWT token part', 'medium', {
          partIndex: i,
          ip: req.ip
        });

        return res.status(403).json({
          success: false,
          message: 'Malformed token structure',
          code: 'TOKEN_MALFORMED'
        });
      }
    }

    // Verify the token
    const decoded = jwt.verify(token, config.jwt.secret);
    
    // Validate decoded token structure
    if (!decoded || typeof decoded !== 'object') {
      Logger.security('Invalid decoded token structure', 'medium', {
        decodedType: typeof decoded,
        ip: req.ip
      });

      return res.status(403).json({
        success: false,
        message: 'Invalid token content',
        code: 'TOKEN_INVALID'
      });
    }

    // Validate required fields in JWT
    if (!decoded.id || !decoded.email) {
      Logger.security('Missing required fields in JWT', 'medium', {
        hasId: !!decoded.id,
        hasEmail: !!decoded.email,
        ip: req.ip
      });

      return res.status(403).json({
        success: false,
        message: 'Invalid token content',
        code: 'TOKEN_INVALID'
      });
    }
    
    // Add user info to request
    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role || 'user', // Default to 'user' if no role specified
      iat: decoded.iat,
      exp: decoded.exp
    };

    next();
  } catch (error) {
    let errorCode = 'TOKEN_INVALID';
    let message = 'Invalid token';

    if (error.name === 'TokenExpiredError') {
      errorCode = 'TOKEN_EXPIRED';
      message = 'Token expired';
      Logger.security('Token expired', 'low', {
        error: error.message,
        ip: req.ip
      });
    } else if (error.name === 'JsonWebTokenError') {
      errorCode = 'TOKEN_MALFORMED';
      message = 'Malformed token';
      Logger.security('JWT verification failed', 'medium', {
        error: error.message,
        ip: req.ip
      });
    } else if (error.name === 'SyntaxError' && error.message.includes('JSON')) {
      errorCode = 'TOKEN_MALFORMED';
      message = 'Invalid token format';
      Logger.security('Token JSON parsing failed', 'medium', {
        error: error.message,
        ip: req.ip
      });
    } else if (error.name === 'NotBeforeError') {
      errorCode = 'TOKEN_NOT_ACTIVE';
      message = 'Token not active';
      Logger.security('Token not yet active', 'medium', {
        error: error.message,
        ip: req.ip
      });
    } else {
      Logger.error('Token verification failed', {
        error: error.message,
        errorName: error.name,
        stack: error.stack,
        ip: req.ip
      });
    }

    return res.status(403).json({
      success: false,
      message,
      code: errorCode
    });
  }
};

// Optional authentication - doesn't fail if no token
const optionalAuth = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    req.user = null;
    req.requestId = uuidv4();
    return next();
  }

  // Use the main auth middleware but catch errors
  authenticateToken(req, res, (error) => {
    if (error) {
      // If auth fails, continue without user but log the attempt
      req.user = null;
      req.requestId = uuidv4();
      Logger.debug('Optional auth failed, continuing without user', {
        error: error.message,
        ip: req.ip
      });
    }
    next();
  });
};

// Role-based authorization middleware
const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
    }

    if (!roles.includes(req.user.role)) {
      Logger.security('Insufficient role permissions', 'medium', {
        userId: req.user.id,
        userRole: req.user.role,
        requiredRoles: roles,
        endpoint: req.originalUrl
      });

      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions',
        code: 'INSUFFICIENT_PERMISSIONS',
        required: roles,
        current: req.user.role
      });
    }

    next();
  };
};

// Subaccount access validation middleware
const validateSubaccountAccess = (requiredPermission = 'read') => {
  return async (req, res, next) => {
    try {
      const subaccountId = req.params.subaccountId || req.body.subaccountId;
      
      if (!subaccountId) {
        return res.status(400).json({
          success: false,
          message: 'Subaccount ID required',
          code: 'SUBACCOUNT_ID_REQUIRED'
        });
      }

      // Import UserSubaccount model (avoid circular dependency)
      const UserSubaccount = require('../models/UserSubaccount');
      
      // Get Redis service instance with proper error handling
      let redisService = null;
      let cachedPermissions = null;
      
      try {
        redisService = redisManager.getRedisService();
      } catch (redisManagerError) {
        Logger.warn('Failed to get Redis service from manager', {
          error: redisManagerError.message,
          userId: req.user.id,
          subaccountId
        });
      }
      
      // Check cache first (only if Redis is available and connected)
      if (redisService && redisService.isConnected) {
        try {
          cachedPermissions = await redisService.getCachedPermissions(req.user.id, subaccountId);
          
          if (cachedPermissions) {
            Logger.debug('Using cached permissions', {
              userId: req.user.id,
              subaccountId,
              permissions: cachedPermissions
            });
          }
        } catch (redisError) {
          Logger.warn('Redis cache check failed, continuing without cache', {
            error: redisError.message,
            errorName: redisError.name,
            userId: req.user.id,
            subaccountId
          });
          // Continue without cache - don't fail the request
          cachedPermissions = null;
        }
      } else {
        Logger.debug('Redis not available, skipping cache check', {
          hasRedisService: !!redisService,
          isConnected: redisService ? redisService.isConnected : false,
          userId: req.user.id,
          subaccountId
        });
      }

      let accessResult;

      if (cachedPermissions) {
        // Use cached permissions
        accessResult = {
          hasAccess: true,
          permissions: cachedPermissions,
          role: cachedPermissions.role || 'viewer'
        };
      } else {
        // Check database
        try {
          accessResult = await UserSubaccount.hasAccess(
            req.user.id, 
            subaccountId, 
            requiredPermission
          );

          if (!accessResult) {
            accessResult = { 
              hasAccess: false, 
              reason: 'Access check returned null result' 
            };
          }
        } catch (dbError) {
          Logger.error('Database access check failed', {
            error: dbError.message,
            stack: dbError.stack,
            userId: req.user.id,
            subaccountId,
            requiredPermission
          });

          return res.status(500).json({
            success: false,
            message: 'Database access check failed',
            code: 'DATABASE_ERROR'
          });
        }

        // Cache the result if access is granted and Redis is available
        if (accessResult.hasAccess && redisService && redisService.isConnected) {
          try {
            await redisService.cachePermissions(
              req.user.id,
              subaccountId,
              accessResult.permissions,
              3600 // 1 hour
            );
            
            Logger.debug('Cached permissions for future use', {
              userId: req.user.id,
              subaccountId
            });
          } catch (cacheError) {
            Logger.warn('Failed to cache permissions', {
              error: cacheError.message,
              errorName: cacheError.name,
              userId: req.user.id,
              subaccountId
            });
            // Don't fail the request if caching fails
          }
        }
      }

      if (!accessResult.hasAccess) {
        Logger.security('Subaccount access denied', 'medium', {
          userId: req.user.id,
          userEmail: req.user.email,
          subaccountId,
          requiredPermission,
          reason: accessResult.reason,
          endpoint: req.originalUrl,
          clientIP: req.ip
        });

        return res.status(403).json({
          success: false,
          message: accessResult.reason || 'Access denied to subaccount',
          code: 'SUBACCOUNT_ACCESS_DENIED',
          details: {
            subaccountId,
            requiredPermission
          }
        });
      }

      // Add subaccount info to request
      req.subaccount = {
        id: subaccountId,
        permissions: accessResult.permissions,
        role: accessResult.role || 'viewer'
      };

      Logger.debug('Subaccount access granted', {
        userId: req.user.id,
        subaccountId,
        role: accessResult.role,
        permission: requiredPermission,
        fromCache: !!cachedPermissions
      });

      next();
    } catch (error) {
      Logger.error('Subaccount access validation failed', {
        error: error.message,
        errorName: error.name,
        stack: error.stack,
        userId: req.user?.id,
        userEmail: req.user?.email,
        subaccountId: req.params.subaccountId || req.body.subaccountId,
        endpoint: req.originalUrl
      });

      return res.status(500).json({
        success: false,
        message: 'Access validation failed',
        code: 'ACCESS_VALIDATION_ERROR'
      });
    }
  };
};

// API key authentication (for service-to-service communication)
const authenticateApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey) {
    return res.status(401).json({
      success: false,
      message: 'API key required',
      code: 'API_KEY_REQUIRED'
    });
  }

  // Validate API key (you should store these securely)
  const validApiKeys = {
    [process.env.AUTH_SERVER_API_KEY]: 'auth-server',
    [process.env.DATABASE_SERVER_API_KEY]: 'database-server'
  };

  const serviceName = validApiKeys[apiKey];
  
  if (!serviceName) {
    Logger.security('Invalid API key', 'high', {
      apiKey: apiKey.substring(0, 8) + '***',
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    return res.status(403).json({
      success: false,
      message: 'Invalid API key',
      code: 'INVALID_API_KEY'
    });
  }

  req.service = {
    name: serviceName,
    apiKey: apiKey
  };

  req.requestId = uuidv4();

  Logger.debug('Service authenticated', {
    service: serviceName,
    requestId: req.requestId
  });

  next();
};

// Request logging middleware
const requestLogger = (req, res, next) => {
  const startTime = Date.now();
  
  // Log incoming request
  Logger.request(req, 'Incoming request', {
    body: req.method !== 'GET' ? req.body : undefined,
    query: req.query
  });

  // Override res.json to log responses
  const originalJson = res.json;
  res.json = function(data) {
    const responseTime = Date.now() - startTime;
    res.responseTime = responseTime;
    
    Logger.response(req, res, 'Request completed', {
      responseTime,
      dataSize: JSON.stringify(data).length
    });
    
    // Performance logging for slow requests
    if (responseTime > 1000) {
      Logger.performance('Slow request', responseTime, 'ms', {
        method: req.method,
        url: req.url,
        userId: req.user?.id
      });
    }
    
    return originalJson.call(this, data);
  };

  next();
};

// Error handling for auth middleware
const authErrorHandler = (error, req, res, next) => {
  if (error.name === 'UnauthorizedError') {
    Logger.security('Unauthorized access attempt', 'medium', {
      error: error.message,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      endpoint: req.originalUrl
    });

    return res.status(401).json({
      success: false,
      message: 'Unauthorized',
      code: 'UNAUTHORIZED'
    });
  }

  next(error);
};

module.exports = {
  authenticateToken,
  optionalAuth,
  requireRole,
  validateSubaccountAccess,
  authenticateApiKey,
  requestLogger,
  authErrorHandler
}; 