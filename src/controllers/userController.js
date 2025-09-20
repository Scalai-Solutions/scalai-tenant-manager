const mongoose = require('mongoose');
const config = require('../../config/config');
const Logger = require('../utils/logger');
const redisManager = require('../services/redisManager');
const Database = require('../utils/database');
const authService = require('../services/authService');

// Import models
const Subaccount = require('../models/Subaccount');
const UserSubaccount = require('../models/UserSubaccount');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');

class UserController {
    // Get subaccount users
  static async getSubaccountUsers(req, res, next) {
    try {
      const { subaccountId } = req.params;
      const userId = req.user.id;
      const { page = 1, limit = 20, role, status } = req.query;

      Logger.audit('Get subaccount users', 'users', {
        userId,
        subaccountId,
        query: req.query
      });

      // Check if user has admin permissions for this subaccount
      const userSubaccount = await UserSubaccount.findOne({
        userId,
        subaccountId,
        isActive: true
      });

      if (!userSubaccount || !userSubaccount.hasPermission('admin')) {
        return res.status(403).json({
          success: false,
          message: 'Admin permissions required to view subaccount users',
          code: 'INSUFFICIENT_PERMISSIONS'
        });
      }

      // Get Redis service instance (dynamic)
      const redisService = redisManager.getRedisService();

      // Check cache first
      const cacheKey = `subaccount_users:${subaccountId}:${JSON.stringify(req.query)}`;
      let cachedData = null;
      
      if (redisService && redisService.isConnected) {
        try {
          cachedData = await redisService.get(cacheKey);
        } catch (error) {
          Logger.warn('Cache get failed, continuing without cache', { error: error.message, cacheKey });
        }
      }
      
      if (cachedData) {
        Logger.debug('Returning cached subaccount users', { subaccountId, cacheKey });
        return res.json({
          success: true,
          message: 'Subaccount users retrieved from cache',
          data: cachedData,
          cached: true
        });
      }

      // Build query
      const query = { subaccountId, isActive: true };
      if (role) query.role = role;

      // Get subaccount users WITHOUT populate (since users are in auth server)
      const skip = (page - 1) * limit;
      const subaccountUsers = await UserSubaccount.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit));

      // Get total count
      const total = await UserSubaccount.countDocuments(query);

      // Get JWT token from request
      const token = req.headers.authorization?.split(' ')[1];
      
      // Fetch user details from auth server for each user
      const usersWithDetails = [];
      
      for (const su of subaccountUsers) {
        try {
          // Get user details from auth server
          const userResult = await authService.getUserById(su.userId, token);
          
          if (userResult.success) {
            const user = userResult.user;
            
            // Apply status filter if specified
            if (status && ((status === 'active' && !user.isActive) || (status === 'inactive' && user.isActive))) {
              continue;
            }
            
            usersWithDetails.push({
              id: user._id || user.id,
              firstName: user.firstName,
              lastName: user.lastName,
              email: user.email,
              isActive: user.isActive,
              lastLogin: user.lastLogin,
              accountCreatedAt: user.createdAt,
              
              // Subaccount-specific data
              role: su.role,
              permissions: su.permissions,
              joinedAt: su.createdAt,
              lastAccessed: su.lastAccessed,
              stats: su.stats,
              invitedBy: su.invitedBy ? {
                id: su.invitedBy,
                name: 'Unknown', // We'd need another API call to get inviter details
                email: 'unknown@example.com'
              } : null,
              invitedAt: su.invitedAt,
              acceptedAt: su.acceptedAt,
              
              // Temporary access
              temporaryAccess: su.temporaryAccess
            });
          } else {
            Logger.warn('Failed to get user details from auth server', {
              userId: su.userId,
              error: userResult.message
            });
          }
        } catch (error) {
          Logger.error('Error fetching user details from auth server', {
            userId: su.userId,
            error: error.message
          });
        }
      }

      const result = {
        users: usersWithDetails,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      };

      // Cache the result for 15 minutes
      if (redisService && redisService.isConnected) {
        try {
          await redisService.set(cacheKey, result, 900);
        } catch (error) {
          Logger.warn('Cache set failed, continuing without caching', { error: error.message, cacheKey });
        }
      }

      Logger.info('Subaccount users retrieved', {
        userId,
        subaccountId,
        count: result.users.length,
        total
      });

      res.json({
        success: true,
        message: 'Subaccount users retrieved successfully',
        data: result
      });

    } catch (error) {
      Logger.error('Get subaccount users error', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
        subaccountId: req.params?.subaccountId
      });

      next(error);
    }
  

      // Check if user has admin permissions for this subaccount
      const userSubaccount = await UserSubaccount.findOne({
        userId,
        subaccountId,
        isActive: true
      });

      if (!userSubaccount || !userSubaccount.hasPermission('admin')) {
        return res.status(403).json({
          success: false,
          message: 'Admin permissions required to view subaccount users',
          code: 'INSUFFICIENT_PERMISSIONS'
        });
      }

      // Get Redis service instance (dynamic)
      const redisService = redisManager.getRedisService();

      // Check cache first
      const cacheKey = `subaccount_users:${subaccountId}:${JSON.stringify(req.query)}`;
      let cachedData = null;
      
      if (redisService && redisService.isConnected) {
        try {
          cachedData = await redisService.get(cacheKey);
        } catch (error) {
          Logger.warn('Cache get failed, continuing without cache', { error: error.message, cacheKey });
        }
      }
      
      if (cachedData) {
        Logger.debug('Returning cached subaccount users', { subaccountId, cacheKey });
        return res.json({
          success: true,
          message: 'Subaccount users retrieved from cache',
          data: cachedData,
          cached: true
        });
      }

      // Build query
      const query = { subaccountId, isActive: true };
      if (role) query.role = role;

      // Get subaccount users with pagination
      const skip = (page - 1) * limit;
      const subaccountUsers = await UserSubaccount.find(query)
        .populate({
          path: 'userId',
          select: 'firstName lastName email lastLogin isActive createdAt',
          match: status ? { isActive: status === 'active' } : {}
        })
        .populate({
          path: 'invitedBy',
          select: 'firstName lastName email'
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit));

      // Filter out null users (from populate match)
      const validUsers = subaccountUsers.filter(su => su.userId);

      // Get total count
      const total = await UserSubaccount.countDocuments(query);

      const result = {
        users: validUsers.map(su => ({
          id: su.userId._id,
          firstName: su.userId.firstName,
          lastName: su.userId.lastName,
          email: su.userId.email,
          isActive: su.userId.isActive,
          lastLogin: su.userId.lastLogin,
          accountCreatedAt: su.userId.createdAt,
          
          // Subaccount-specific data
          role: su.role,
          permissions: su.permissions,
          joinedAt: su.createdAt,
          lastAccessed: su.lastAccessed,
          stats: su.stats,
          invitedBy: su.invitedBy ? {
            id: su.invitedBy._id,
            name: `${su.invitedBy.firstName} ${su.invitedBy.lastName}`,
            email: su.invitedBy.email
          } : null,
          invitedAt: su.invitedAt,
          acceptedAt: su.acceptedAt,
          
          // Temporary access
          temporaryAccess: su.temporaryAccess
        })),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      };

      // Cache the result for 15 minutes
      if (redisService && redisService.isConnected) {
        try {
          await redisService.set(cacheKey, result, 900);
        } catch (error) {
          Logger.warn('Cache set failed, continuing without caching', { error: error.message, cacheKey });
        }
      }

      Logger.info('Subaccount users retrieved', {
        userId,
        subaccountId,
        count: result.users.length,
        total
      });

      res.json({
        success: true,
        message: 'Subaccount users retrieved successfully',
        data: result
      });

    } catch (error) {
      Logger.error('Failed to get subaccount users', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
        subaccountId: req.params.subaccountId
      });
      next(error);
    }
  

  // Invite user to subaccount
  static async inviteUser(req, res, next) {
    try {
      const { subaccountId } = req.params;
      const userId = req.user.id;
      const { email, role = 'viewer', permissions = {}, temporaryAccess = {} } = req.body;

      Logger.audit('Invite user to subaccount', 'invitation', {
        userId,
        subaccountId,
        inviteeEmail: email,
        role
      });

      // Check if user has admin permissions
      const userSubaccount = await UserSubaccount.findOne({
        userId,
        subaccountId,
        isActive: true
      });

      if (!userSubaccount || !userSubaccount.hasPermission('admin')) {
        return res.status(403).json({
          success: false,
          message: 'Admin permissions required to invite users',
          code: 'INSUFFICIENT_PERMISSIONS'
        });
      }

      // Check if subaccount exists and is active
      const subaccount = await Subaccount.findOne({
        _id: subaccountId,
        isActive: true
      });

      if (!subaccount) {
        return res.status(404).json({
          success: false,
          message: 'Subaccount not found or inactive',
          code: 'SUBACCOUNT_NOT_FOUND'
        });
      }

      // Check user limit
      const currentUserCount = await UserSubaccount.countDocuments({
        subaccountId,
        isActive: true
      });

      if (currentUserCount >= config.security.maxUsersPerSubaccount) {
        return res.status(400).json({
          success: false,
          message: `Maximum ${config.security.maxUsersPerSubaccount} users allowed per subaccount`,
          code: 'USER_LIMIT_EXCEEDED'
        });
      }

      // Find the user to invite via auth service
      const authService = require('../services/authService');
      const token = req.headers.authorization?.split(' ')[1];
      
      const userResult = await authService.validateUser(email, token);
      if (!userResult.success) {
        return res.status(404).json({
          success: false,
          message: userResult.message === 'User not found' ? 'User not found or inactive' : userResult.message,
          code: 'USER_NOT_FOUND'
        });
      }
      
      const inviteeUser = userResult.user;

      // Check if user is already associated with this subaccount
      const existingAssociation = await UserSubaccount.findOne({
        userId: inviteeUser.id,
        subaccountId,
        isActive: true
      });

      if (existingAssociation) {
        return res.status(400).json({
          success: false,
          message: 'User is already associated with this subaccount',
          code: 'USER_ALREADY_EXISTS'
        });
      }

      // Validate role
      const validRoles = ['viewer', 'editor', 'admin'];
      if (!validRoles.includes(role)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid role specified',
          code: 'INVALID_ROLE'
        });
      }

      // Create user-subaccount relationship
      const newUserSubaccount = new UserSubaccount({
        userId: inviteeUser.id,
        subaccountId,
        role,
        permissions: {
          ...permissions,
          // Override with role-based defaults
          ...(role === 'viewer' && { read: true, write: false, delete: false, admin: false }),
          ...(role === 'editor' && { read: true, write: true, delete: false, admin: false }),
          ...(role === 'admin' && { read: true, write: true, delete: true, admin: false })
        },
        invitedBy: userId,
        invitedAt: new Date(),
        acceptedAt: new Date(), // Auto-accept for now
        temporaryAccess: temporaryAccess.enabled ? {
          enabled: true,
          expiresAt: new Date(temporaryAccess.expiresAt),
          reason: temporaryAccess.reason || 'Temporary access granted'
        } : { enabled: false }
      });

      await newUserSubaccount.save();

      // Update subaccount user count
      await Subaccount.findByIdAndUpdate(
        subaccountId,
        { 
          $inc: { 'stats.totalUsers': 1 },
          updatedAt: new Date()
        }
      );

      // Update invitee's subaccount count
      await User.findByIdAndUpdate(
        inviteeUser._id,
        { $inc: { subaccountCount: 1 } }
      );

      // Invalidate caches
      const redisService = redisManager.getRedisService();
      if (redisService && redisService.isConnected) {
        try {
          await Promise.all([
            redisService.invalidateUserSubaccounts(inviteeUser._id),
            redisService.invalidateSubaccountCache(subaccountId)
          ]);
        } catch (error) {
          Logger.warn('Cache invalidation failed', { error: error.message });
        }
      }

      Logger.info('User invited to subaccount successfully', {
        userId,
        subaccountId,
        inviteeId: inviteeUser._id,
        inviteeEmail: email,
        role
      });

      // Return response
      const response = {
        id: newUserSubaccount._id,
        user: {
          id: inviteeUser._id,
          firstName: inviteeUser.firstName,
          lastName: inviteeUser.lastName,
          email: inviteeUser.email
        },
        role: newUserSubaccount.role,
        permissions: newUserSubaccount.permissions,
        invitedBy: {
          id: userId,
          name: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim(),
          email: req.user.email
        },
        invitedAt: newUserSubaccount.invitedAt,
        acceptedAt: newUserSubaccount.acceptedAt,
        temporaryAccess: newUserSubaccount.temporaryAccess
      };

      res.status(201).json({
        success: true,
        message: 'User invited to subaccount successfully',
        data: response
      });

    } catch (error) {
      Logger.error('Failed to invite user to subaccount', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
        subaccountId: req.params.subaccountId,
        email: req.body?.email
      });
      next(error);
    }
  }

  // Update user permissions
  static async updateUserPermissions(req, res, next) {
    try {
      const { subaccountId, targetUserId } = req.params;
      const userId = req.user.id;
      const { role, permissions, temporaryAccess } = req.body;

      Logger.audit('Update user permissions', 'permissions', {
        userId,
        subaccountId,
        targetUserId,
        updates: { role, permissions, temporaryAccess }
      });

      // Check if user has admin permissions
      const userSubaccount = await UserSubaccount.findOne({
        userId,
        subaccountId,
        isActive: true
      });

      if (!userSubaccount || !userSubaccount.hasPermission('admin')) {
        return res.status(403).json({
          success: false,
          message: 'Admin permissions required to update user permissions',
          code: 'INSUFFICIENT_PERMISSIONS'
        });
      }

      // Prevent self-modification of admin status
      if (targetUserId === userId && role && role !== userSubaccount.role) {
        return res.status(400).json({
          success: false,
          message: 'Cannot modify your own role',
          code: 'SELF_MODIFICATION_DENIED'
        });
      }

      // Find target user-subaccount relationship
      const targetUserSubaccount = await UserSubaccount.findOne({
        userId: targetUserId,
        subaccountId,
        isActive: true
      });

      if (!targetUserSubaccount) {
        return res.status(404).json({
          success: false,
          message: 'User not found in this subaccount',
          code: 'USER_NOT_FOUND'
        });
      }

      // Prevent modification of owner role (only owner can modify owner)
      if (targetUserSubaccount.role === 'owner' && userSubaccount.role !== 'owner') {
        return res.status(403).json({
          success: false,
          message: 'Only owner can modify owner permissions',
          code: 'OWNER_MODIFICATION_DENIED'
        });
      }

      // Build update object
      const updates = {};
      
      if (role) {
        const validRoles = ['viewer', 'editor', 'admin'];
        if (!validRoles.includes(role)) {
          return res.status(400).json({
            success: false,
            message: 'Invalid role specified',
            code: 'INVALID_ROLE'
          });
        }
        updates.role = role;
      }

      if (permissions) {
        updates.permissions = {
          ...targetUserSubaccount.permissions.toObject(),
          ...permissions
        };
      }

      if (temporaryAccess !== undefined) {
        updates.temporaryAccess = temporaryAccess.enabled ? {
          enabled: true,
          expiresAt: new Date(temporaryAccess.expiresAt),
          reason: temporaryAccess.reason || 'Temporary access updated'
        } : { enabled: false };
      }

      updates.updatedAt = new Date();

      // Update user permissions
      const updatedUserSubaccount = await UserSubaccount.findByIdAndUpdate(
        targetUserSubaccount._id,
        updates,
        { 
          new: true,
          runValidators: true
        }
      ).populate('userId', 'firstName lastName email');

      // Invalidate caches
      const redisService = redisManager.getRedisService();
      if (redisService && redisService.isConnected) {
        try {
          await Promise.all([
            redisService.invalidatePermissions(targetUserId, subaccountId),
            redisService.invalidateUserSubaccounts(targetUserId)
          ]);
        } catch (error) {
          Logger.warn('Cache invalidation failed', { error: error.message });
        }
      }

      Logger.info('User permissions updated successfully', {
        userId,
        subaccountId,
        targetUserId,
        updatedFields: Object.keys(updates)
      });

      const response = {
        id: updatedUserSubaccount._id,
        user: {
          id: updatedUserSubaccount.userId._id,
          firstName: updatedUserSubaccount.userId.firstName,
          lastName: updatedUserSubaccount.userId.lastName,
          email: updatedUserSubaccount.userId.email
        },
        role: updatedUserSubaccount.role,
        permissions: updatedUserSubaccount.permissions,
        temporaryAccess: updatedUserSubaccount.temporaryAccess,
        updatedAt: updatedUserSubaccount.updatedAt
      };

      res.json({
        success: true,
        message: 'User permissions updated successfully',
        data: response
      });

    } catch (error) {
      Logger.error('Failed to update user permissions', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
        subaccountId: req.params.subaccountId,
        targetUserId: req.params.targetUserId
      });
      next(error);
    }
  }

  // Remove user from subaccount
  static async removeUser(req, res, next) {
    try {
      const { subaccountId, targetUserId } = req.params;
      const userId = req.user.id;

      Logger.audit('Remove user from subaccount', 'user_removal', {
        userId,
        subaccountId,
        targetUserId
      });

      // Check if user has admin permissions
      const userSubaccount = await UserSubaccount.findOne({
        userId,
        subaccountId,
        isActive: true
      });

      if (!userSubaccount || !userSubaccount.hasPermission('admin')) {
        return res.status(403).json({
          success: false,
          message: 'Admin permissions required to remove users',
          code: 'INSUFFICIENT_PERMISSIONS'
        });
      }

      // Find target user-subaccount relationship
      const targetUserSubaccount = await UserSubaccount.findOne({
        userId: targetUserId,
        subaccountId,
        isActive: true
      });

      if (!targetUserSubaccount) {
        return res.status(404).json({
          success: false,
          message: 'User not found in this subaccount',
          code: 'USER_NOT_FOUND'
        });
      }

      // Prevent removal of owner (only owner can remove themselves)
      if (targetUserSubaccount.role === 'owner' && targetUserId !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Cannot remove subaccount owner',
          code: 'OWNER_REMOVAL_DENIED'
        });
      }

      // Use transaction for atomic operation
      await Database.withTransaction(async (session) => {
        // Deactivate user-subaccount relationship
        await UserSubaccount.findByIdAndUpdate(
          targetUserSubaccount._id,
          { 
            isActive: false,
            updatedAt: new Date()
          },
          { session }
        );

        // Update subaccount user count
        await Subaccount.findByIdAndUpdate(
          subaccountId,
          { 
            $inc: { 'stats.totalUsers': -1 },
            updatedAt: new Date()
          },
          { session }
        );

        // Update user's subaccount count
        const activeSubaccounts = await UserSubaccount.countDocuments({
          userId: targetUserId,
          isActive: true
        });

        await User.findByIdAndUpdate(
          targetUserId,
          { subaccountCount: activeSubaccounts },
          { session }
        );
      });

      // Invalidate caches
      const redisService = redisManager.getRedisService();
      if (redisService && redisService.isConnected) {
        try {
          await Promise.all([
            redisService.invalidateUserSubaccounts(targetUserId),
            redisService.invalidatePermissions(targetUserId, subaccountId),
            redisService.invalidateSubaccountCache(subaccountId)
          ]);
        } catch (error) {
          Logger.warn('Cache invalidation failed', { error: error.message });
        }
      }

      Logger.security('User removed from subaccount', 'medium', {
        userId,
        subaccountId,
        targetUserId,
        targetRole: targetUserSubaccount.role
      });

      res.json({
        success: true,
        message: 'User removed from subaccount successfully'
      });

    } catch (error) {
      Logger.error('Failed to remove user from subaccount', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
        subaccountId: req.params.subaccountId,
        targetUserId: req.params.targetUserId
      });
      next(error);
    }
  }

  // Get user's activity in subaccount
  static async getUserActivity(req, res, next) {
    try {
      const { subaccountId, targetUserId } = req.params;
      const userId = req.user.id;
      const { days = 30 } = req.query;

      Logger.audit('Get user activity', 'activity', {
        userId,
        subaccountId,
        targetUserId,
        days
      });

      // Check permissions (admin can see all, users can see their own)
      const userSubaccount = await UserSubaccount.findOne({
        userId,
        subaccountId,
        isActive: true
      });

      if (!userSubaccount) {
        return res.status(403).json({
          success: false,
          message: 'Access denied to subaccount',
          code: 'ACCESS_DENIED'
        });
      }

      // Only admin can see other users' activity
      if (targetUserId !== userId && !userSubaccount.hasPermission('admin')) {
        return res.status(403).json({
          success: false,
          message: 'Admin permissions required to view other users activity',
          code: 'INSUFFICIENT_PERMISSIONS'
        });
      }

      // Get target user-subaccount relationship
      const targetUserSubaccount = await UserSubaccount.findOne({
        userId: targetUserId,
        subaccountId,
        isActive: true
      }).populate('userId', 'firstName lastName email');

      if (!targetUserSubaccount) {
        return res.status(404).json({
          success: false,
          message: 'User not found in this subaccount',
          code: 'USER_NOT_FOUND'
        });
      }

      // Get audit logs for this user in this subaccount
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - parseInt(days));

      const auditLogs = await AuditLog.find({
        userId: targetUserId,
        subaccountId,
        createdAt: { $gte: startDate }
      })
      .select('operation collectionName result createdAt requestContext.ipAddress')
      .sort({ createdAt: -1 })
      .limit(1000);

      // Aggregate statistics
      const stats = {
        totalOperations: auditLogs.length,
        successfulOperations: auditLogs.filter(log => log.result.success).length,
        failedOperations: auditLogs.filter(log => !log.result.success).length,
        operationTypes: {},
        collections: {},
        dailyActivity: {},
        uniqueIPs: new Set()
      };

      auditLogs.forEach(log => {
        // Operation types
        stats.operationTypes[log.operation] = (stats.operationTypes[log.operation] || 0) + 1;
        
        // Collections
        if (log.collectionName) {
          stats.collections[log.collectionName] = (stats.collections[log.collectionName] || 0) + 1;
        }
        
        // Daily activity
        const date = log.createdAt.toISOString().split('T')[0];
        stats.dailyActivity[date] = (stats.dailyActivity[date] || 0) + 1;
        
        // IP addresses
        if (log.requestContext?.ipAddress) {
          stats.uniqueIPs.add(log.requestContext.ipAddress);
        }
      });

      stats.uniqueIPs = stats.uniqueIPs.size;

      const response = {
        user: {
          id: targetUserSubaccount.userId._id,
          firstName: targetUserSubaccount.userId.firstName,
          lastName: targetUserSubaccount.userId.lastName,
          email: targetUserSubaccount.userId.email
        },
        role: targetUserSubaccount.role,
        permissions: targetUserSubaccount.permissions,
        stats: targetUserSubaccount.stats,
        lastAccessed: targetUserSubaccount.lastAccessed,
        activity: {
          period: `${days} days`,
          statistics: stats,
          recentOperations: auditLogs.slice(0, 50).map(log => ({
            operation: log.operation,
            collection: log.collectionName,
            success: log.result.success,
            timestamp: log.createdAt,
            ipAddress: log.requestContext?.ipAddress
          }))
        }
      };

      Logger.info('User activity retrieved', {
        userId,
        subaccountId,
        targetUserId,
        operationCount: auditLogs.length
      });

      res.json({
        success: true,
        message: 'User activity retrieved successfully',
        data: response
      });

    } catch (error) {
      Logger.error('Failed to get user activity', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
        subaccountId: req.params.subaccountId,
        targetUserId: req.params.targetUserId
      });
      next(error);
    }
  }
}

module.exports = UserController; 