const mongoose = require('mongoose');
const config = require('../../config/config');
const Logger = require('../utils/logger');
const redisManager = require('../services/redisManager');
const Database = require('../utils/database');

// Get Redis service instance
const redisService = redisManager.getRedisService();

// Import models
const Subaccount = require('../models/Subaccount');
const UserSubaccount = require('../models/UserSubaccount');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');

class SubaccountController {
  // Get user's subaccounts with caching
  static async getUserSubaccounts(req, res, next) {
    const startTime = Date.now();
    try {
      const userId = req.user.id;
      const { page = 1, limit = 20, role, status } = req.query;
      
      Logger.audit('Get user subaccounts', 'subaccounts', {
        userId,
        query: req.query
      });

      Logger.debug('Starting getUserSubaccounts', { userId, startTime });

      // Check cache first (if Redis is connected)
      let cachedData = null;
      const cacheKey = `user_subaccounts:${userId}:${JSON.stringify(req.query)}`;
      
      if (redisService.isConnected) {
        try {
          cachedData = await redisService.get(cacheKey);
        } catch (error) {
          Logger.warn('Cache get failed, continuing without cache', { error: error.message, cacheKey });
        }
      }
      
      if (cachedData) {
        Logger.debug('Returning cached subaccounts', { userId, cacheKey });
        return res.json({
          success: true,
          message: 'Subaccounts retrieved from cache',
          data: cachedData,
          cached: true
        });
      }

      // Build query
      const query = { userId, isActive: true };
      if (role) query.role = role;

      // Get user subaccounts with pagination and timeout
      const skip = (page - 1) * limit;
      
      // Add timeout to prevent hanging queries
      const queryTimeout = 15000; // 15 seconds
      
      const [userSubaccounts, total] = await Promise.all([
        UserSubaccount.find(query)
          .populate({
            path: 'subaccountId',
            match: status ? { isActive: status === 'active' } : {},
            select: 'name description isActive stats createdAt maintenanceMode rateLimits'
          })
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit))
          .maxTimeMS(queryTimeout),
        UserSubaccount.countDocuments(query).maxTimeMS(queryTimeout)
      ]);

      // Filter out null subaccounts (from populate match)
      const validSubaccounts = userSubaccounts.filter(us => us.subaccountId);

      const result = {
        subaccounts: validSubaccounts.map(us => ({
          id: us.subaccountId._id,
          name: us.subaccountId.name,
          description: us.subaccountId.description,
          isActive: us.subaccountId.isActive,
          maintenanceMode: us.subaccountId.maintenanceMode,
          role: us.role,
          permissions: us.permissions,
          stats: us.subaccountId.stats,
          rateLimits: us.subaccountId.rateLimits,
          joinedAt: us.createdAt,
          lastAccessed: us.lastAccessed,
          userStats: us.stats
        })),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      };

      // Cache the result for 30 minutes (if Redis is connected)
      if (redisService.isConnected) {
        try {
          await redisService.set(cacheKey, result, 1800);
        } catch (error) {
          Logger.warn('Cache set failed, continuing without caching', { error: error.message, cacheKey });
        }
      }

      const duration = Date.now() - startTime;
      Logger.info('User subaccounts retrieved', {
        userId,
        count: result.subaccounts.length,
        total,
        duration: `${duration}ms`
      });

      res.json({
        success: true,
        message: 'Subaccounts retrieved successfully',
        data: result,
        meta: {
          duration: `${duration}ms`,
          cached: false
        }
      });

    } catch (error) {
      // Check if it's a timeout error
      if (error.name === 'MongooseError' && error.message.includes('timeout')) {
        Logger.error('Database query timeout in getUserSubaccounts', {
          userId: req.user?.id,
          query: req.query,
          error: error.message,
          timeout: '15s'
        });
        
        return res.status(408).json({
          success: false,
          message: 'Request timeout - database query took too long',
          code: 'DATABASE_TIMEOUT'
        });
      }

      Logger.error('Failed to get user subaccounts', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id
      });
      next(error);
    }
  }

  // Get single subaccount details
  static async getSubaccount(req, res, next) {
    try {
      const { subaccountId } = req.params;
      const userId = req.user.id;

      Logger.audit('Get subaccount details', 'subaccount', {
        userId,
        subaccountId
      });

      // Check cache first
      const cachedSubaccount = await redisService.getSubaccount(subaccountId);
      if (cachedSubaccount) {
        Logger.debug('Returning cached subaccount', { subaccountId });
        return res.json({
          success: true,
          message: 'Subaccount retrieved from cache',
          data: cachedSubaccount,
          cached: true
        });
      }

      // Get subaccount with user permissions
      const userSubaccount = await UserSubaccount.findOne({
        userId,
        subaccountId,
        isActive: true
      }).populate({
        path: 'subaccountId',
        select: '-mongodbUrl -encryptionIV -encryptionAuthTag'
      });

      if (!userSubaccount || !userSubaccount.subaccountId) {
        return res.status(404).json({
          success: false,
          message: 'Subaccount not found or access denied',
          code: 'SUBACCOUNT_NOT_FOUND'
        });
      }

      const subaccount = userSubaccount.subaccountId;
      
      // Get additional statistics
      const userCount = await UserSubaccount.countDocuments({
        subaccountId,
        isActive: true
      });

      const result = {
        id: subaccount._id,
        name: subaccount.name,
        description: subaccount.description,
        databaseName: subaccount.databaseName,
        isActive: subaccount.isActive,
        maintenanceMode: subaccount.maintenanceMode,
        maintenanceMessage: subaccount.maintenanceMessage,
        maxConnections: subaccount.maxConnections,
        enforceSchema: subaccount.enforceSchema,
        allowedCollections: subaccount.allowedCollections,
        stats: {
          ...subaccount.stats.toObject(),
          userCount
        },
        rateLimits: subaccount.rateLimits,
        createdAt: subaccount.createdAt,
        updatedAt: subaccount.updatedAt,
        
        // User-specific data
        userRole: userSubaccount.role,
        userPermissions: userSubaccount.permissions,
        userStats: userSubaccount.stats,
        joinedAt: userSubaccount.createdAt,
        lastAccessed: userSubaccount.lastAccessed
      };

      // Cache the result
      await redisService.cacheSubaccount(subaccountId, result, 3600);

      Logger.info('Subaccount details retrieved', {
        userId,
        subaccountId,
        role: userSubaccount.role
      });

      res.json({
        success: true,
        message: 'Subaccount retrieved successfully',
        data: result
      });

    } catch (error) {
      Logger.error('Failed to get subaccount details', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
        subaccountId: req.params.subaccountId
      });
      next(error);
    }
  }

  // Create new subaccount
  static async createSubaccount(req, res, next) {
    try {
      const userId = req.user.id;
      const {
        name,
        description,
        mongodbUrl,
        databaseName,
        maxConnections = 5,
        enforceSchema = true,
        allowedCollections = [],
        rateLimits = {}
      } = req.body;

      Logger.audit('Create subaccount', 'subaccount', {
        userId,
        name,
        databaseName
      });

      // Check if user has reached subaccount limit
      const userSubaccountCount = await UserSubaccount.countDocuments({
        userId,
        isActive: true
      });

      if (userSubaccountCount >= config.security.maxSubaccountsPerUser) {
        Logger.security('Subaccount limit exceeded', 'medium', {
          userId,
          currentCount: userSubaccountCount,
          limit: config.security.maxSubaccountsPerUser
        });

        return res.status(400).json({
          success: false,
          message: `Maximum ${config.security.maxSubaccountsPerUser} subaccounts allowed per user`,
          code: 'SUBACCOUNT_LIMIT_EXCEEDED'
        });
      }

      // Validate MongoDB URL format and allowed hosts
      if (!this.validateMongoUrl(mongodbUrl)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid MongoDB URL format',
          code: 'INVALID_MONGODB_URL'
        });
      }

      if (!this.isHostAllowed(mongodbUrl)) {
        Logger.security('Unauthorized MongoDB host', 'high', {
          userId,
          mongodbUrl: this.maskConnectionString(mongodbUrl)
        });

        return res.status(403).json({
          success: false,
          message: 'MongoDB host not allowed',
          code: 'HOST_NOT_ALLOWED'
        });
      }

      // Use transaction for atomic operation
      const result = await Database.withTransaction(async (session) => {
        // Create subaccount
        const subaccount = new Subaccount({
          name,
          description,
          mongodbUrl, // Will be encrypted by pre-save middleware
          databaseName,
          maxConnections: Math.min(maxConnections, 20), // Cap at 20
          enforceSchema,
          allowedCollections,
          createdBy: userId,
          rateLimits: {
            queriesPerMinute: rateLimits.queriesPerMinute || 100,
            queriesPerHour: rateLimits.queriesPerHour || 1000,
            queriesPerDay: rateLimits.queriesPerDay || 10000
          }
        });

        await subaccount.save({ session });

        // Test connection before proceeding
        const connectionTest = await subaccount.testConnection();
        if (!connectionTest.success) {
          throw new Error(`Connection test failed: ${connectionTest.message}`);
        }

        // Create user-subaccount relationship with owner permissions
        const userSubaccount = new UserSubaccount({
          userId,
          subaccountId: subaccount._id,
          role: 'owner',
          invitedBy: userId,
          invitedAt: new Date(),
          acceptedAt: new Date()
        });

        await userSubaccount.save({ session });

        // Update user subaccount count
        await User.findByIdAndUpdate(
          userId,
          { $inc: { subaccountCount: 1 } },
          { session }
        );

        return { subaccount, userSubaccount };
      });

      // Invalidate user cache
      await redisService.invalidateUserSubaccounts(userId);

      Logger.info('Subaccount created successfully', {
        userId,
        subaccountId: result.subaccount._id,
        name,
        databaseName
      });

      // Return sanitized response
      const response = {
        id: result.subaccount._id,
        name: result.subaccount.name,
        description: result.subaccount.description,
        databaseName: result.subaccount.databaseName,
        isActive: result.subaccount.isActive,
        maxConnections: result.subaccount.maxConnections,
        enforceSchema: result.subaccount.enforceSchema,
        allowedCollections: result.subaccount.allowedCollections,
        rateLimits: result.subaccount.rateLimits,
        createdAt: result.subaccount.createdAt,
        role: result.userSubaccount.role,
        permissions: result.userSubaccount.permissions
      };

      res.status(201).json({
        success: true,
        message: 'Subaccount created successfully',
        data: response
      });

    } catch (error) {
      Logger.error('Failed to create subaccount', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
        name: req.body?.name
      });
      
      if (error.code === 11000) {
        return res.status(400).json({
          success: false,
          message: 'Subaccount name already exists',
          code: 'DUPLICATE_NAME'
        });
      }
      
      next(error);
    }
  }

  // Update subaccount
  static async updateSubaccount(req, res, next) {
    try {
      const { subaccountId } = req.params;
      const userId = req.user.id;
      const updates = req.body;

      Logger.audit('Update subaccount', 'subaccount', {
        userId,
        subaccountId,
        updates: Object.keys(updates)
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
          message: 'Admin permissions required to update subaccount',
          code: 'INSUFFICIENT_PERMISSIONS'
        });
      }

      // Filter allowed updates
      const allowedUpdates = [
        'name', 'description', 'maxConnections', 'enforceSchema',
        'allowedCollections', 'rateLimits', 'maintenanceMode', 'maintenanceMessage'
      ];
      
      const filteredUpdates = {};
      Object.keys(updates).forEach(key => {
        if (allowedUpdates.includes(key)) {
          filteredUpdates[key] = updates[key];
        }
      });

      // Validate maxConnections
      if (filteredUpdates.maxConnections) {
        filteredUpdates.maxConnections = Math.min(filteredUpdates.maxConnections, 20);
      }

      // Update subaccount
      const subaccount = await Subaccount.findByIdAndUpdate(
        subaccountId,
        { 
          ...filteredUpdates,
          updatedAt: new Date()
        },
        { 
          new: true,
          runValidators: true,
          select: '-mongodbUrl -encryptionIV -encryptionAuthTag'
        }
      );

      if (!subaccount) {
        return res.status(404).json({
          success: false,
          message: 'Subaccount not found',
          code: 'SUBACCOUNT_NOT_FOUND'
        });
      }

      // Invalidate caches
      await Promise.all([
        redisService.invalidateSubaccount(subaccountId),
        redisService.invalidateUserSubaccounts(userId)
      ]);

      Logger.info('Subaccount updated successfully', {
        userId,
        subaccountId,
        updatedFields: Object.keys(filteredUpdates)
      });

      res.json({
        success: true,
        message: 'Subaccount updated successfully',
        data: subaccount
      });

    } catch (error) {
      Logger.error('Failed to update subaccount', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
        subaccountId: req.params.subaccountId
      });
      next(error);
    }
  }

  // Delete subaccount (soft delete)
  static async deleteSubaccount(req, res, next) {
    try {
      const { subaccountId } = req.params;
      const userId = req.user.id;

      Logger.audit('Delete subaccount', 'subaccount', {
        userId,
        subaccountId
      });

      // Check if user is owner
      const userSubaccount = await UserSubaccount.findOne({
        userId,
        subaccountId,
        role: 'owner',
        isActive: true
      });

      if (!userSubaccount) {
        return res.status(403).json({
          success: false,
          message: 'Only subaccount owner can delete subaccount',
          code: 'OWNER_REQUIRED'
        });
      }

      // Use transaction for atomic operation
      await Database.withTransaction(async (session) => {
        // Soft delete subaccount
        await Subaccount.findByIdAndUpdate(
          subaccountId,
          { 
            isActive: false,
            updatedAt: new Date()
          },
          { session }
        );

        // Deactivate all user-subaccount relationships
        await UserSubaccount.updateMany(
          { subaccountId },
          { 
            isActive: false,
            updatedAt: new Date()
          },
          { session }
        );

        // Update user subaccount count
        const userCount = await UserSubaccount.countDocuments({
          userId,
          isActive: true
        });
        
        await User.findByIdAndUpdate(
          userId,
          { subaccountCount: userCount },
          { session }
        );
      });

      // Invalidate all related caches
      await redisService.invalidateSubaccountCache(subaccountId);

      Logger.security('Subaccount deleted', 'medium', {
        userId,
        subaccountId,
        action: 'delete'
      });

      res.json({
        success: true,
        message: 'Subaccount deleted successfully'
      });

    } catch (error) {
      Logger.error('Failed to delete subaccount', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
        subaccountId: req.params.subaccountId
      });
      next(error);
    }
  }

  // Test subaccount connection
  static async testConnection(req, res, next) {
    try {
      const { subaccountId } = req.params;
      const userId = req.user.id;

      Logger.audit('Test subaccount connection', 'subaccount', {
        userId,
        subaccountId
      });

      // Check admin permissions
      const userSubaccount = await UserSubaccount.findOne({
        userId,
        subaccountId,
        isActive: true
      });

      if (!userSubaccount || !userSubaccount.hasPermission('admin')) {
        return res.status(403).json({
          success: false,
          message: 'Admin permissions required',
          code: 'INSUFFICIENT_PERMISSIONS'
        });
      }

      // Get subaccount with encrypted connection string
      const subaccount = await Subaccount.findById(subaccountId).select('+mongodbUrl +encryptionIV +encryptionAuthTag');
      
      if (!subaccount) {
        return res.status(404).json({
          success: false,
          message: 'Subaccount not found',
          code: 'SUBACCOUNT_NOT_FOUND'
        });
      }

      // Test connection
      const connectionTest = await subaccount.testConnection();

      Logger.info('Connection test completed', {
        userId,
        subaccountId,
        success: connectionTest.success,
        message: connectionTest.message
      });

      res.json({
        success: true,
        message: 'Connection test completed',
        data: {
          connected: connectionTest.success,
          message: connectionTest.message,
          timestamp: new Date()
        }
      });

    } catch (error) {
      Logger.error('Connection test failed', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
        subaccountId: req.params.subaccountId
      });
      next(error);
    }
  }

  // Helper methods
  static validateMongoUrl(url) {
    try {
      const mongoUrlRegex = /^mongodb(\+srv)?:\/\/.+/;
      return mongoUrlRegex.test(url);
    } catch (error) {
      return false;
    }
  }

  static isHostAllowed(url) {
    if (!config.security.allowedHosts.length) {
      return true; // No restrictions if no hosts specified
    }

    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;
      
      return config.security.allowedHosts.some(allowedHost => {
        if (allowedHost.includes('*')) {
          const regex = new RegExp(allowedHost.replace(/\*/g, '.*'));
          return regex.test(hostname);
        }
        return hostname === allowedHost;
      });
    } catch (error) {
      return false;
    }
  }

  static maskConnectionString(connectionString) {
    if (!connectionString) return '';
    
    try {
      const url = new URL(connectionString);
      if (url.password) {
        url.password = '***';
      }
      if (url.username) {
        url.username = url.username.substring(0, 3) + '***';
      }
      return url.toString();
    } catch {
      return connectionString.replace(/\/\/.*@/, '//***:***@');
    }
  }
}

module.exports = SubaccountController; 