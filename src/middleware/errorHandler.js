const config = require('../../config/config');
const Logger = require('../utils/logger');

const errorHandler = (error, req, res, next) => {
  // Default error
  let statusCode = 500;
  let message = 'Internal server error';
  let code = 'INTERNAL_ERROR';
  let details = null;

  // Log the error
  Logger.error('Error occurred', {
    error: error.message,
    stack: error.stack,
    url: req.originalUrl,
    method: req.method,
    userId: req.user?.id,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });

  // Handle specific error types
  if (error.name === 'ValidationError') {
    statusCode = 400;
    message = 'Validation failed';
    code = 'VALIDATION_ERROR';
    details = Object.values(error.errors).map(err => ({
      field: err.path,
      message: err.message
    }));
  } else if (error.name === 'CastError') {
    statusCode = 400;
    message = 'Invalid ID format';
    code = 'INVALID_ID';
  } else if (error.code === 11000) {
    statusCode = 409;
    message = 'Duplicate entry';
    code = 'DUPLICATE_ERROR';
    
    // Extract field from duplicate key error
    const field = Object.keys(error.keyPattern)[0];
    details = { field, message: `${field} already exists` };
  } else if (error.name === 'MongoError') {
    statusCode = 500;
    message = 'Database error';
    code = 'DATABASE_ERROR';
  } else if (error.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token';
    code = 'INVALID_TOKEN';
  } else if (error.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Token expired';
    code = 'TOKEN_EXPIRED';
  } else if (error.status) {
    statusCode = error.status;
    message = error.message;
    code = error.code || 'HTTP_ERROR';
  }

  // Don't expose internal errors in production
  if (config.server.nodeEnv === 'production' && statusCode === 500) {
    message = 'Internal server error';
    details = null;
  }

  // Send error response
  const errorResponse = {
    success: false,
    message,
    code,
    timestamp: new Date(),
    path: req.originalUrl,
    method: req.method
  };

  if (details) {
    errorResponse.details = details;
  }

  if (config.server.nodeEnv === 'development') {
    errorResponse.stack = error.stack;
  }

  res.status(statusCode).json(errorResponse);
};

module.exports = errorHandler; 