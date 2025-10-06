const Logger = require('../utils/logger');

// Validate connector creation
const validateCreateConnector = (req, res, next) => {
  const { type, name, config } = req.body;
  const errors = [];

  // Validate type
  if (!type || typeof type !== 'string') {
    errors.push('Connector type is required and must be a string');
  } else {
    const validTypes = ['google_calendar', 'outlook_calendar', 'zoom', 'slack', 'teams', 'webhook', 'custom'];
    if (!validTypes.includes(type)) {
      errors.push(`Invalid connector type. Must be one of: ${validTypes.join(', ')}`);
    }
  }

  // Validate name
  if (!name || typeof name !== 'string') {
    errors.push('Connector name is required and must be a string');
  } else if (name.length < 2 || name.length > 100) {
    errors.push('Connector name must be between 2 and 100 characters');
  }

  // Validate config
  if (!config || typeof config !== 'object') {
    errors.push('Config is required and must be an object');
  }

  if (errors.length > 0) {
    Logger.warn('Connector creation validation failed', {
      errors,
      body: req.body
    });
    
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors,
      code: 'VALIDATION_ERROR'
    });
  }

  next();
};

// Validate connector update
const validateUpdateConnector = (req, res, next) => {
  const updates = req.body;
  const errors = [];

  // Validate name if provided
  if (updates.name !== undefined) {
    if (typeof updates.name !== 'string' || updates.name.length < 2 || updates.name.length > 100) {
      errors.push('Connector name must be a string between 2 and 100 characters');
    }
  }

  // Validate description if provided
  if (updates.description !== undefined && updates.description !== null) {
    if (typeof updates.description !== 'string' || updates.description.length > 500) {
      errors.push('Description must be a string with maximum 500 characters');
    }
  }

  // Validate config if provided
  if (updates.config !== undefined && typeof updates.config !== 'object') {
    errors.push('Config must be an object');
  }

  // Validate isActive if provided
  if (updates.isActive !== undefined && typeof updates.isActive !== 'boolean') {
    errors.push('isActive must be a boolean');
  }

  // Validate isGlobal if provided
  if (updates.isGlobal !== undefined && typeof updates.isGlobal !== 'boolean') {
    errors.push('isGlobal must be a boolean');
  }

  // Validate category if provided
  if (updates.category !== undefined) {
    const validCategories = ['calendar', 'communication', 'video', 'productivity', 'custom', 'other'];
    if (!validCategories.includes(updates.category)) {
      errors.push(`Invalid category. Must be one of: ${validCategories.join(', ')}`);
    }
  }

  // Don't allow changing type
  if (updates.type !== undefined) {
    errors.push('Connector type cannot be changed');
  }

  if (errors.length > 0) {
    Logger.warn('Connector update validation failed', {
      errors,
      updates
    });
    
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors,
      code: 'VALIDATION_ERROR'
    });
  }

  next();
};

// Validate connector ID parameter
const validateConnectorId = (req, res, next) => {
  const { connectorId } = req.params;

  if (!connectorId || !connectorId.match(/^[0-9a-fA-F]{24}$/)) {
    Logger.warn('Invalid connector ID format', { connectorId });
    
    return res.status(400).json({
      success: false,
      message: 'Invalid connector ID format',
      code: 'INVALID_CONNECTOR_ID'
    });
  }

  next();
};

module.exports = {
  validateCreateConnector,
  validateUpdateConnector,
  validateConnectorId
};

