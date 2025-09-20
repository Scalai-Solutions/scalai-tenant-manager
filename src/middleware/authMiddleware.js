const jwt = require('jsonwebtoken');
const config = require('../../config/config');
const Logger = require('../utils/logger');
const redisService = require('../services/redisService');
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

    // Verify the token
    const decoded = jwt.verify(token, config.jwt.secret);
    
    // Add user info to request
    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role, // Include role from JWT
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
      Logger.security('Malformed token', 'medium', {
        error: error.message,
        ip: req.ip
      });
    } else {
      Logger.error('Token verification failed', {
        error: error.message,
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
      
      // Check cache first
      const cachedPermissions = await redisService.getCachedPermissions(req.user.id, subaccountId);
      let accessResult;

      if (cachedPermissions) {
        Logger.debug('Using cached permissions', {
          userId: req.user.id,
          subaccountId,
          permissions: cachedPermissions
        });

        // Simulate access check result
        accessResult = {
          hasAccess: true,
          permissions: cachedPermissions,
          role: cachedPermissions.role
        };
      } else {
        // Check database
        accessResult = await UserSubaccount.hasAccess(
          req.user.id, 
          subaccountId, 
          requiredPermission
        );

        // Cache the result if access is granted
        if (accessResult.hasAccess) {
          await redisService.cachePermissions(
            req.user.id,
            subaccountId,
            accessResult.permissions,
            3600 // 1 hour
          );
        }
      }

      if (!accessResult.hasAccess) {
        Logger.security('Subaccount access denied', 'medium', {
          userId: req.user.id,
          subaccountId,
          requiredPermission,
          reason: accessResult.reason
        });

        return res.status(403).json({
          success: false,
          message: accessResult.reason || 'Access denied to subaccount',
          code: 'SUBACCOUNT_ACCESS_DENIED'
        });
      }

      // Add subaccount info to request
      req.subaccount = {
        id: subaccountId,
        permissions: accessResult.permissions,
        role: accessResult.role
      };

      Logger.debug('Subaccount access granted', {
        userId: req.user.id,
        subaccountId,
        role: accessResult.role,
        permission: requiredPermission
      });

      next();
    } catch (error) {
      Logger.error('Subaccount access validation failed', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
        subaccountId: req.params.subaccountId || req.body.subaccountId
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