const express = require('express');
const router = express.Router();

// Import controllers
const UserController = require('../controllers/userController');

// Import middleware
const { 
  requestLogger 
} = require('../middleware/authMiddleware');

const {
  authenticateTokenOrService,
  validateUserAccessOrService
} = require('../middleware/serviceAuthMiddleware');

const { 
  userLimiter, 
  burstProtection, 
  subaccountLimiter 
} = require('../middleware/rateLimiter');

// Import validators
const { 
  validateInviteUser,
  validateUpdatePermissions,
  validateUpdateUserDetails,
  validateSubaccountId,
  validateUserId 
} = require('../validators/userValidator');

// Apply common middleware
router.use(requestLogger);
router.use(authenticateTokenOrService);
router.use(userLimiter);

// Routes for subaccount user management

// GET /api/subaccounts/:subaccountId/users - Get subaccount users
router.get('/:subaccountId/users',
  validateSubaccountId,
  validateUserAccessOrService('read'),
  UserController.getSubaccountUsers
);

// POST /api/subaccounts/:subaccountId/users - Invite user to subaccount
router.post('/:subaccountId/users',
  validateSubaccountId,
  validateUserAccessOrService('write'),
  burstProtection, // Prevent rapid invitations
  validateInviteUser,
  UserController.inviteUser
);

// PUT /api/subaccounts/:subaccountId/users/:targetUserId - Update user permissions
router.put('/:subaccountId/users/:targetUserId',
  validateSubaccountId,
  validateUserId('targetUserId'),
  validateUserAccessOrService('write'),
  validateUpdatePermissions,
  UserController.updateUserPermissions
);

// PATCH /api/subaccounts/:subaccountId/users/:targetUserId/details - Update user details (firstName, lastName, email)
router.patch('/:subaccountId/users/:targetUserId/details',
  validateSubaccountId,
  validateUserId('targetUserId'),
  validateUserAccessOrService('write'),
  validateUpdateUserDetails,
  UserController.updateUserDetails
);

// DELETE /api/subaccounts/:subaccountId/users/:targetUserId - Remove user from subaccount
router.delete('/:subaccountId/users/:targetUserId',
  validateSubaccountId,
  validateUserId('targetUserId'),
  validateUserAccessOrService('write'),
  burstProtection, // Prevent rapid user removal
  UserController.removeUser
);

// GET /api/subaccounts/:subaccountId/users/:targetUserId/activity - Get user activity
router.get('/:subaccountId/users/:targetUserId/activity',
  validateSubaccountId,
  validateUserId('targetUserId'),
  validateUserAccessOrService('read'), // Users can see their own activity
  subaccountLimiter(20, 60000), // Max 20 activity requests per minute
  UserController.getUserActivity
);

module.exports = router; 