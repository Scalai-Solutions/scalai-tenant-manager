const Joi = require('joi');
const mongoose = require('mongoose');
const Logger = require('../utils/logger');

// MongoDB URL validation regex
const mongoUrlRegex = /^mongodb(\+srv)?:\/\/[^\s]+$/;

// Validation schemas
const createSubaccountSchema = Joi.object({
  name: Joi.string()
    .trim()
    .min(2)
    .max(100)
    .required()
    .messages({
      'string.empty': 'Subaccount name is required',
      'string.min': 'Name must be at least 2 characters long',
      'string.max': 'Name cannot exceed 100 characters'
    }),
    
  description: Joi.string()
    .trim()
    .max(500)
    .allow('')
    .messages({
      'string.max': 'Description cannot exceed 500 characters'
    }),
    
  mongodbUrl: Joi.string()
    .trim()
    .pattern(mongoUrlRegex)
    .required()
    .messages({
      'string.empty': 'MongoDB URL is required',
      'string.pattern.base': 'Invalid MongoDB URL format'
    }),
    
  databaseName: Joi.string()
    .trim()
    .pattern(/^[a-zA-Z0-9_-]+$/)
    .min(1)
    .max(64)
    .required()
    .messages({
      'string.empty': 'Database name is required',
      'string.pattern.base': 'Database name can only contain letters, numbers, underscores, and hyphens',
      'string.max': 'Database name cannot exceed 64 characters'
    }),
    
  maxConnections: Joi.number()
    .integer()
    .min(1)
    .max(20)
    .default(5)
    .messages({
      'number.min': 'Maximum connections must be at least 1',
      'number.max': 'Maximum connections cannot exceed 20'
    }),
    
  enforceSchema: Joi.boolean()
    .default(true),
    
  allowedCollections: Joi.array()
    .items(
      Joi.alternatives().try(
        // Wildcard option - allow all collections
        Joi.string().valid('*').messages({
          'any.only': 'Wildcard must be exactly "*" to allow all collections'
        }),
        // Specific collection configuration
        Joi.object({
          name: Joi.string()
            .trim()
            .pattern(/^[a-zA-Z0-9_-]+$/)
            .required()
            .messages({
              'string.pattern.base': 'Collection name can only contain letters, numbers, underscores, and hyphens'
            }),
          schema: Joi.object().default({}),
          permissions: Joi.object({
            read: Joi.boolean().default(true),
            write: Joi.boolean().default(true),
            delete: Joi.boolean().default(false)
          }).default()
        })
      )
    )
    .default([])
    .custom((value, helpers) => {
      // Custom validation for wildcard rules
      if (!Array.isArray(value)) return value;
      
      const hasWildcard = value.some(item => item === '*');
      
      if (hasWildcard) {
        // If wildcard is present, it must be the only item
        if (value.length !== 1) {
          return helpers.error('any.custom', { 
            message: 'Wildcard "*" must be the only item in allowedCollections array' 
          });
        }
        
        // Ensure the wildcard is exactly "*"
        if (value[0] !== '*') {
          return helpers.error('any.custom', { 
            message: 'Wildcard must be exactly "*"' 
          });
        }
      }
      
      return value;
    })
    .messages({
      'array.base': 'Allowed collections must be an array',
      'alternatives.match': 'Each item must be either "*" (wildcard) or a collection configuration object',
      'any.custom': '{{#message}}'
    }),
    
  rateLimits: Joi.object({
    queriesPerMinute: Joi.number()
      .integer()
      .min(1)
      .max(1000)
      .default(100),
    queriesPerHour: Joi.number()
      .integer()
      .min(1)
      .max(10000)
      .default(1000),
    queriesPerDay: Joi.number()
      .integer()
      .min(1)
      .max(100000)
      .default(10000)
  }).default()
});

const updateSubaccountSchema = Joi.object({
  name: Joi.string()
    .trim()
    .min(2)
    .max(100)
    .messages({
      'string.min': 'Name must be at least 2 characters long',
      'string.max': 'Name cannot exceed 100 characters'
    }),
    
  description: Joi.string()
    .trim()
    .max(500)
    .allow('')
    .messages({
      'string.max': 'Description cannot exceed 500 characters'
    }),
    
  maxConnections: Joi.number()
    .integer()
    .min(1)
    .max(20)
    .messages({
      'number.min': 'Maximum connections must be at least 1',
      'number.max': 'Maximum connections cannot exceed 20'
    }),
    
  enforceSchema: Joi.boolean(),
    
  allowedCollections: Joi.array()
    .items(
      Joi.alternatives().try(
        // Wildcard option - allow all collections
        Joi.string().valid('*').messages({
          'any.only': 'Wildcard must be exactly "*" to allow all collections'
        }),
        // Specific collection configuration
        Joi.object({
          name: Joi.string()
            .trim()
            .pattern(/^[a-zA-Z0-9_-]+$/)
            .required()
            .messages({
              'string.pattern.base': 'Collection name can only contain letters, numbers, underscores, and hyphens'
            }),
          schema: Joi.object().default({}),
          permissions: Joi.object({
            read: Joi.boolean().default(true),
            write: Joi.boolean().default(true),
            delete: Joi.boolean().default(false)
          }).default()
        })
      )
    )
    .messages({
      'array.base': 'Allowed collections must be an array',
      'alternatives.match': 'Each item must be either "*" (wildcard) or a collection configuration object'
    }),
    
  rateLimits: Joi.object({
    queriesPerMinute: Joi.number()
      .integer()
      .min(1)
      .max(1000),
    queriesPerHour: Joi.number()
      .integer()
      .min(1)
      .max(10000),
    queriesPerDay: Joi.number()
      .integer()
      .min(1)
      .max(100000)
  }),
  
  maintenanceMode: Joi.boolean(),
  
  maintenanceMessage: Joi.string()
    .trim()
    .max(500)
    .allow('')
    .messages({
      'string.max': 'Maintenance message cannot exceed 500 characters'
    })
}).min(1).messages({
  'object.min': 'At least one field must be provided for update'
});

// Middleware functions
const validateCreateSubaccount = (req, res, next) => {
  const { error, value } = createSubaccountSchema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true
  });
  
  if (error) {
    const errors = error.details.map(detail => ({
      field: detail.path.join('.'),
      message: detail.message
    }));
    
    Logger.warn('Subaccount creation validation failed', {
      userId: req.user?.id,
      errors,
      body: req.body
    });
    
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      code: 'VALIDATION_ERROR',
      errors
    });
  }
  
  // Replace req.body with validated and sanitized data
  req.body = value;
  next();
};

const validateUpdateSubaccount = (req, res, next) => {
  const { error, value } = updateSubaccountSchema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true
  });
  
  if (error) {
    const errors = error.details.map(detail => ({
      field: detail.path.join('.'),
      message: detail.message
    }));
    
    Logger.warn('Subaccount update validation failed', {
      userId: req.user?.id,
      subaccountId: req.params.subaccountId,
      errors,
      body: req.body
    });
    
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      code: 'VALIDATION_ERROR',
      errors
    });
  }
  
  // Replace req.body with validated and sanitized data
  req.body = value;
  next();
};

const validateSubaccountId = (req, res, next) => {
  const { subaccountId } = req.params;
  
  if (!mongoose.Types.ObjectId.isValid(subaccountId)) {
    Logger.warn('Invalid subaccount ID format', {
      userId: req.user?.id,
      subaccountId,
      ip: req.ip
    });
    
    return res.status(400).json({
      success: false,
      message: 'Invalid subaccount ID format',
      code: 'INVALID_ID_FORMAT'
    });
  }
  
  next();
};

// Query parameter validation
const validateQueryParams = (req, res, next) => {
  const querySchema = Joi.object({
    page: Joi.number()
      .integer()
      .min(1)
      .default(1),
    limit: Joi.number()
      .integer()
      .min(1)
      .max(100)
      .default(20),
    role: Joi.string()
      .valid('viewer', 'editor', 'admin', 'owner'),
    status: Joi.string()
      .valid('active', 'inactive'),
    sort: Joi.string()
      .valid('name', 'createdAt', 'updatedAt', 'lastAccessed')
      .default('createdAt'),
    order: Joi.string()
      .valid('asc', 'desc')
      .default('desc')
  });
  
  const { error, value } = querySchema.validate(req.query, {
    abortEarly: false,
    stripUnknown: true
  });
  
  if (error) {
    const errors = error.details.map(detail => ({
      field: detail.path.join('.'),
      message: detail.message
    }));
    
    return res.status(400).json({
      success: false,
      message: 'Invalid query parameters',
      code: 'INVALID_QUERY_PARAMS',
      errors
    });
  }
  
  req.query = value;
  next();
};

// Additional validation helpers
const validateConnectionString = (connectionString) => {
  try {
    // Basic MongoDB URL validation
    if (!mongoUrlRegex.test(connectionString)) {
      return { valid: false, error: 'Invalid MongoDB URL format' };
    }
    
    // Parse URL to check components
    const url = new URL(connectionString);
    
    // Check protocol
    if (!['mongodb:', 'mongodb+srv:'].includes(url.protocol)) {
      return { valid: false, error: 'Invalid MongoDB protocol' };
    }
    
    // Check hostname
    if (!url.hostname) {
      return { valid: false, error: 'Missing hostname in MongoDB URL' };
    }
    
    // Check for suspicious patterns
    const suspiciousPatterns = [
      /localhost/i,
      /127\.0\.0\.1/,
      /0\.0\.0\.0/,
      /192\.168\./,
      /10\./,
      /172\.1[6-9]\./,
      /172\.2[0-9]\./,
      /172\.3[0-1]\./
    ];
    
    const isSuspicious = suspiciousPatterns.some(pattern => 
      pattern.test(url.hostname)
    );
    
    if (isSuspicious) {
      return { 
        valid: false, 
        error: 'Private/local network addresses are not allowed',
        suspicious: true 
      };
    }
    
    return { valid: true };
  } catch (error) {
    return { valid: false, error: 'Invalid URL format' };
  }
};

const validateDatabaseName = (databaseName) => {
  const reservedNames = [
    'admin', 'local', 'config', 'test',
    'information_schema', 'performance_schema',
    'mysql', 'sys'
  ];
  
  if (reservedNames.includes(databaseName.toLowerCase())) {
    return { valid: false, error: 'Database name is reserved' };
  }
  
  if (databaseName.length > 64) {
    return { valid: false, error: 'Database name too long' };
  }
  
  if (!/^[a-zA-Z0-9_-]+$/.test(databaseName)) {
    return { valid: false, error: 'Database name contains invalid characters' };
  }
  
  return { valid: true };
};

module.exports = {
  validateCreateSubaccount,
  validateUpdateSubaccount,
  validateSubaccountId,
  validateQueryParams,
  validateConnectionString,
  validateDatabaseName,
  createSubaccountSchema,
  updateSubaccountSchema
}; 