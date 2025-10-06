const express = require('express');
const router = express.Router();

// Import controllers
const SubaccountController = require('../controllers/subaccountController');
const RetellController = require('../controllers/retellController');

// Import middleware
const { 
  authenticateToken, 
  validateSubaccountAccess, 
  requireRole,
  requestLogger 
} = require('../middleware/authMiddleware');

const { 
  authenticateTokenOrService,
  requireServicePermission,
  validateSubaccountAccessOrService 
} = require('../middleware/serviceAuthMiddleware');

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

const {
  validateCreateRetellAccount,
  validateUpdateRetellAccount
} = require('../validators/retellValidator');

// Apply common middleware
router.use(requestLogger);

// Use combined authentication (supports both JWT and service tokens)
router.use(authenticateTokenOrService);
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
  requireRole('admin'),
  SubaccountController.createSubaccount
);

// GET /api/subaccounts/:subaccountId - Get specific subaccount
router.get('/:subaccountId',
  validateSubaccountId,
  validateSubaccountAccessOrService('read'),
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

// POST /api/subaccounts/:subaccountId/invite-calendar - Invite email for calendar integration
router.post('/:subaccountId/invite-calendar',
  validateSubaccountId,
  validateSubaccountAccess('admin'),
  SubaccountController.inviteEmailForCalendar
);

// DELETE /api/subaccounts/:subaccountId/cache - Invalidate subaccount cache
router.delete('/:subaccountId/cache',
  validateSubaccountId,
  validateSubaccountAccess('admin'),
  SubaccountController.invalidateCache
);

// Retell Account Routes

// GET /api/subaccounts/:subaccountId/retell - Get retell account
router.get('/:subaccountId/retell',
  validateSubaccountId,
  validateSubaccountAccessOrService('read'),
  RetellController.getRetellAccount
);

// PUT /api/subaccounts/:subaccountId/retell - Create or update retell account (upsert)
router.put('/:subaccountId/retell',
  validateSubaccountId,
  validateSubaccountAccess('admin'),
  validateCreateRetellAccount,
  RetellController.upsertRetellAccount
);

// PATCH /api/subaccounts/:subaccountId/retell - Partially update retell account
router.patch('/:subaccountId/retell',
  validateSubaccountId,
  validateSubaccountAccess('admin'),
  validateUpdateRetellAccount,
  RetellController.updateRetellAccount
);

// DELETE /api/subaccounts/:subaccountId/retell - Delete retell account
router.delete('/:subaccountId/retell',
  validateSubaccountId,
  validateSubaccountAccess('admin'),
  burstProtection, // Prevent rapid deletions
  RetellController.deleteRetellAccount
);

module.exports = router; 