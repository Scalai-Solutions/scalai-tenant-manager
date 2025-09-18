const Joi = require('joi');
const mongoose = require('mongoose');
const Logger = require('../utils/logger');

// Validation schemas
const inviteUserSchema = Joi.object({
  email: Joi.string()
    .email()
    .required()
    .messages({
      'string.email': 'Please provide a valid email address',
      'string.empty': 'Email is required'
    }),
    
  role: Joi.string()
    .valid('viewer', 'editor', 'admin')
    .default('viewer')
    .messages({
      'any.only': 'Role must be one of: viewer, editor, admin'
    }),
    
  permissions: Joi.object({
    read: Joi.boolean().default(true),
    write: Joi.boolean().default(false),
    delete: Joi.boolean().default(false),
    admin: Joi.boolean().default(false),
    
    collections: Joi.array().items(
      Joi.object({
        name: Joi.string().required(),
        permissions: Joi.object({
          read: Joi.boolean().default(true),
          write: Joi.boolean().default(false),
          delete: Joi.boolean().default(false)
        })
      })
    ).default([]),
    
    queryLimits: Joi.object({
      maxDocuments: Joi.number().integer().min(1).max(10000).default(1000),
      maxQueryTime: Joi.number().integer().min(1000).max(60000).default(30000),
      allowAggregation: Joi.boolean().default(true),
      allowTextSearch: Joi.boolean().default(true)
    }).default()
  }).default(),
  
  temporaryAccess: Joi.object({
    enabled: Joi.boolean().default(false),
    expiresAt: Joi.date().when('enabled', {
      is: true,
      then: Joi.required(),
      otherwise: Joi.optional()
    }),
    reason: Joi.string().max(500).when('enabled', {
      is: true,
      then: Joi.required(),
      otherwise: Joi.optional()
    })
  }).default({ enabled: false })
});

const updatePermissionsSchema = Joi.object({
  role: Joi.string()
    .valid('viewer', 'editor', 'admin')
    .messages({
      'any.only': 'Role must be one of: viewer, editor, admin'
    }),
    
  permissions: Joi.object({
    read: Joi.boolean(),
    write: Joi.boolean(),
    delete: Joi.boolean(),
    admin: Joi.boolean(),
    
    collections: Joi.array().items(
      Joi.object({
        name: Joi.string().required(),
        permissions: Joi.object({
          read: Joi.boolean(),
          write: Joi.boolean(),
          delete: Joi.boolean()
        })
      })
    ),
    
    queryLimits: Joi.object({
      maxDocuments: Joi.number().integer().min(1).max(10000),
      maxQueryTime: Joi.number().integer().min(1000).max(60000),
      allowAggregation: Joi.boolean(),
      allowTextSearch: Joi.boolean()
    })
  }),
  
  temporaryAccess: Joi.object({
    enabled: Joi.boolean(),
    expiresAt: Joi.date().when('enabled', {
      is: true,
      then: Joi.required(),
      otherwise: Joi.optional()
    }),
    reason: Joi.string().max(500).when('enabled', {
      is: true,
      then: Joi.required(),
      otherwise: Joi.optional()
    })
  })
}).min(1).messages({
  'object.min': 'At least one field must be provided for update'
});

// Middleware functions
const validateInviteUser = (req, res, next) => {
  const { error, value } = inviteUserSchema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true
  });
  
  if (error) {
    const errors = error.details.map(detail => ({
      field: detail.path.join('.'),
      message: detail.message
    }));
    
    Logger.warn('User invitation validation failed', {
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
  
  req.body = value;
  next();
};

const validateUpdatePermissions = (req, res, next) => {
  const { error, value } = updatePermissionsSchema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true
  });
  
  if (error) {
    const errors = error.details.map(detail => ({
      field: detail.path.join('.'),
      message: detail.message
    }));
    
    Logger.warn('Permission update validation failed', {
      userId: req.user?.id,
      subaccountId: req.params.subaccountId,
      targetUserId: req.params.targetUserId,
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

const validateUserId = (paramName = 'userId') => {
  return (req, res, next) => {
    const userId = req.params[paramName];
    
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      Logger.warn('Invalid user ID format', {
        userId: req.user?.id,
        targetUserId: userId,
        ip: req.ip
      });
      
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID format',
        code: 'INVALID_USER_ID_FORMAT'
      });
    }
    
    next();
  };
};

module.exports = {
  validateInviteUser,
  validateUpdatePermissions,
  validateSubaccountId,
  validateUserId,
  inviteUserSchema,
  updatePermissionsSchema
}; 