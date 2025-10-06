const express = require('express');
const router = express.Router();

// Import controller
const ConnectorController = require('../controllers/connectorController');

// Import middleware
const { 
  authenticateToken, 
  requireRole,
  requestLogger 
} = require('../middleware/authMiddleware');

const { 
  userLimiter, 
  burstProtection 
} = require('../middleware/rateLimiter');

// Import validators
const { 
  validateCreateConnector,
  validateUpdateConnector,
  validateConnectorId 
} = require('../validators/connectorValidator');

// Apply common middleware
router.use(requestLogger);
router.use(authenticateToken);
router.use(userLimiter);

// Routes

// GET /api/connectors - Get all connectors
router.get('/', 
  ConnectorController.getAllConnectors
);

// POST /api/connectors - Create new connector (admin only)
router.post('/',
  requireRole('admin'),
  burstProtection,
  // validateCreateConnector,
  ConnectorController.createConnector
);

// GET /api/connectors/:connectorId - Get specific connector
router.get('/:connectorId',
  validateConnectorId,
  ConnectorController.getConnectorById
);

// PUT /api/connectors/:connectorId - Update connector (admin only)
router.put('/:connectorId',
  requireRole('admin'),
  validateConnectorId,
  // validateUpdateConnector,
  ConnectorController.updateConnector
);

// DELETE /api/connectors/:connectorId - Delete connector (admin only)
router.delete('/:connectorId',
  requireRole('admin'),
  validateConnectorId,
  burstProtection,
  ConnectorController.deleteConnector
);

module.exports = router;

