const Joi = require('joi');
const Logger = require('../utils/logger');

// Validation schemas
const createRetellAccountSchema = Joi.object({
  apiKey: Joi.string()
    .trim()
    .min(10)
    .required()
    .messages({
      'string.empty': 'Retell API key is required',
      'string.min': 'API key must be at least 10 characters long'
    }),
    
  accountName: Joi.string()
    .trim()
    .max(100)
    .allow('')
    .messages({
      'string.max': 'Account name cannot exceed 100 characters'
    })
});

const updateRetellAccountSchema = Joi.object({
  apiKey: Joi.string()
    .trim()
    .min(10)
    .messages({
      'string.empty': 'Retell API key cannot be empty',
      'string.min': 'API key must be at least 10 characters long'
    }),
    
  accountName: Joi.string()
    .trim()
    .max(100)
    .allow('')
    .messages({
      'string.max': 'Account name cannot exceed 100 characters'
    }),
    
  isActive: Joi.boolean()
}).min(1).messages({
  'object.min': 'At least one field must be provided for update'
});

// Middleware functions
const validateCreateRetellAccount = (req, res, next) => {
  const { error, value } = createRetellAccountSchema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true
  });
  
  if (error) {
    const errors = error.details.map(detail => ({
      field: detail.path.join('.'),
      message: detail.message
    }));
    
    Logger.warn('Retell account creation validation failed', {
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

const validateUpdateRetellAccount = (req, res, next) => {
  const { error, value } = updateRetellAccountSchema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true
  });
  
  if (error) {
    const errors = error.details.map(detail => ({
      field: detail.path.join('.'),
      message: detail.message
    }));
    
    Logger.warn('Retell account update validation failed', {
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

module.exports = {
  validateCreateRetellAccount,
  validateUpdateRetellAccount,
  createRetellAccountSchema,
  updateRetellAccountSchema
}; 