const express = require('express');
const router = express.Router();

// Import controllers
const UserController = require('../controllers/userController');

// Import middleware
const { 
  authenticateToken, 
  validateSubaccountAccess, 
  requestLogger 
} = require('../middleware/authMiddleware');

const { 
  userLimiter, 
  burstProtection, 
  subaccountLimiter 
} = require('../middleware/rateLimiter');

// Import validators
const { 
  validateInviteUser,
  validateUpdatePermissions,
  validateSubaccountId,
  validateUserId 
} = require('../validators/userValidator');

// Apply common middleware
router.use(requestLogger);
router.use(authenticateToken);
router.use(userLimiter);

// Routes for subaccount user management

// GET /api/subaccounts/:subaccountId/users - Get subaccount users
router.get('/:subaccountId/users',
  validateSubaccountId,
  validateSubaccountAccess('admin'),
  UserController.getSubaccountUsers
);

// POST /api/subaccounts/:subaccountId/users - Invite user to subaccount
router.post('/:subaccountId/users',
  validateSubaccountId,
  validateSubaccountAccess('admin'),
  burstProtection, // Prevent rapid invitations
  validateInviteUser,
  UserController.inviteUser
);

// PUT /api/subaccounts/:subaccountId/users/:targetUserId - Update user permissions
router.put('/:subaccountId/users/:targetUserId',
  validateSubaccountId,
  validateUserId('targetUserId'),
  validateSubaccountAccess('admin'),
  validateUpdatePermissions,
  UserController.updateUserPermissions
);

// DELETE /api/subaccounts/:subaccountId/users/:targetUserId - Remove user from subaccount
router.delete('/:subaccountId/users/:targetUserId',
  validateSubaccountId,
  validateUserId('targetUserId'),
  validateSubaccountAccess('admin'),
  burstProtection, // Prevent rapid user removal
  UserController.removeUser
);

// GET /api/subaccounts/:subaccountId/users/:targetUserId/activity - Get user activity
router.get('/:subaccountId/users/:targetUserId/activity',
  validateSubaccountId,
  validateUserId('targetUserId'),
  validateSubaccountAccess('read'), // Users can see their own activity
  subaccountLimiter(20, 60000), // Max 20 activity requests per minute
  UserController.getUserActivity
);

module.exports = router; 