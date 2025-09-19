const express = require('express');
const router = express.Router();

// Import controllers
const SubaccountController = require('../controllers/subaccountController');

// Import middleware
const { 
  authenticateToken, 
  validateSubaccountAccess, 
  requestLogger 
} = require('../middleware/authMiddleware');

const { 
  userLimiter, 
  subaccountLimiter, 
  burstProtection 
} = require('../middleware/rateLimiter');

// Import validators
const { 
  validateCreateSubaccount,
  validateUpdateSubaccount,
  validateSubaccountId 
} = require('../validators/subaccountValidator');

// Apply common middleware
router.use(requestLogger);

router.use(authenticateToken);
router.use(userLimiter);

// Routes

// GET /api/subaccounts - Get user's subaccounts
router.get('/', 
  SubaccountController.getUserSubaccounts
);

// POST /api/subaccounts - Create new subaccount
router.post('/',
  burstProtection, // Prevent rapid subaccount creation
  validateCreateSubaccount,
  SubaccountController.createSubaccount
);

// GET /api/subaccounts/:subaccountId - Get specific subaccount
router.get('/:subaccountId',
  validateSubaccountId,
  validateSubaccountAccess('read'),
  SubaccountController.getSubaccount
);

// PUT /api/subaccounts/:subaccountId - Update subaccount
router.put('/:subaccountId',
  validateSubaccountId,
  validateSubaccountAccess('admin'),
  validateUpdateSubaccount,
  SubaccountController.updateSubaccount
);

// DELETE /api/subaccounts/:subaccountId - Delete subaccount
router.delete('/:subaccountId',
  validateSubaccountId,
  validateSubaccountAccess('admin'),
  burstProtection, // Prevent rapid deletions
  SubaccountController.deleteSubaccount
);

// POST /api/subaccounts/:subaccountId/test-connection - Test connection
router.post('/:subaccountId/test-connection',
  validateSubaccountId,
  validateSubaccountAccess('admin'),
  subaccountLimiter(5, 60000), // Max 5 connection tests per minute
  SubaccountController.testConnection
);

module.exports = router; 