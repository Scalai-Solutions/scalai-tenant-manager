const mongoose = require('mongoose');
const config = require('../../config/config');
const Logger = require('../utils/logger');
const redisManager = require('../services/redisManager');
const Database = require('../utils/database');
const webhookService = require('../services/webhookService');

// Import models
const Subaccount = require('../models/Subaccount');
const UserSubaccount = require('../models/UserSubaccount');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const Connector = require('../models/Connector');

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

      // Get Redis service instance (dynamic)
      const redisService = redisManager.getRedisService();

      // Check cache first (if Redis is connected)
      let cachedData = null;
      const cacheKey = `user_subaccounts:${userId}:${JSON.stringify(req.query)}`;
      
      if (redisService && redisService.isConnected) {
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
      
      Logger.debug('Executing database query', { query, skip, limit, queryTimeout });
      
      try {
        const [userSubaccounts, total] = await Promise.race([
          Promise.all([
            UserSubaccount.find(query)
              .populate({
                path: 'subaccountId',
                match: status ? { isActive: status === 'active' } : {},
                select: 'name description isActive stats createdAt maintenanceMode rateLimits activatedConnectors',
                populate: {
                  path: 'activatedConnectors.connectorId',
                  select: 'type name icon category'
                }
              })
              .sort({ createdAt: -1 })
              .skip(skip)
              .limit(parseInt(limit))
              .maxTimeMS(queryTimeout),
            UserSubaccount.countDocuments(query).maxTimeMS(queryTimeout)
          ]),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Database query timeout')), queryTimeout + 1000)
          )
        ]);

        Logger.debug('Database query completed', { 
          userSubaccountsCount: userSubaccounts.length, 
          total,
          duration: Date.now() - startTime 
        });

        // Filter out null subaccounts (from populate match)
        const validSubaccounts = userSubaccounts.filter(us => us.subaccountId);
        console.log('[DEBUG] Filtered subaccounts', { validCount: validSubaccounts.length });

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
            userStats: us.stats,
            activatedConnectors: us.subaccountId.activatedConnectors
              .filter(ac => ac.connectorId && ac.isActive)
              .map(ac => ({
                type: ac.connectorId.type,
                name: ac.connectorId.name,
                icon: ac.connectorId.icon,
                category: ac.connectorId.category
              }))
          })),
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / limit)
          }
        };

        // Cache the result for 30 minutes (if Redis is connected)
        if (redisService && redisService.isConnected) {
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
          data: result
        });
      } catch (dbError) {
        console.log('[DEBUG] Database query failed', dbError.message);
        Logger.error('Database query failed', {
          error: dbError.message,
          query,
          userId,
          duration: Date.now() - startTime
        });
        throw new Error(`Database query failed: ${dbError.message}`);
      }

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
      
      // Handle both service tokens and user tokens
      const isServiceRequest = !!req.service;
      const userId = req.user?.id || null;
      const serviceName = req.service?.serviceName || null;

      Logger.audit('Get subaccount details', 'subaccounts', {
        userId,
        serviceName,
        subaccountId,
        isServiceRequest
      });

      // Check if this is a service request or specific conditions
      const needsMongoUrl = isServiceRequest || 
                           req.headers['x-service-name'] === 'database-server' || 
                           req.headers['user-agent']?.includes('axios') ||
                           req.user?.role === 'super_admin';

      // Get Redis service instance (dynamic)
      const redisService = redisManager.getRedisService();

      // For service requests, we need fresh data with MongoDB URL
      let cachedSubaccount = null;
      if (!needsMongoUrl) {
        // Check cache first for regular user requests
        cachedSubaccount = await redisService.getCachedSubaccount(subaccountId);
        if (cachedSubaccount) {
          Logger.debug('Returning cached subaccount', { subaccountId });
          return res.json({
            success: true,
            message: 'Subaccount retrieved from cache',
            data: cachedSubaccount,
            cached: true
          });
        }
      }

      // Check if user has access (middleware should have already validated this)
      // Handle both service requests and user requests
      let userSubaccount = null;
      let userRole = 'viewer';
      
      if (isServiceRequest) {
        // Service requests have already been validated by middleware
        userRole = 'service';
      } else if (req.user?.role === 'super_admin' || req.user?.role === 'admin') {
        // Admin users have full access, use the role from middleware
        userRole = req.subaccount?.role || req.user.role;
      } else if (req.user) {
        // Regular users need to have a UserSubaccount record
        userSubaccount = await UserSubaccount.findOne({
          userId,
          subaccountId,
          isActive: true
        });

        if (!userSubaccount) {
          return res.status(403).json({
            success: false,
            message: 'Access denied to subaccount',
            code: 'SUBACCOUNT_ACCESS_DENIED'
          });
        }
        
        userRole = userSubaccount.role;
      } else {
        return res.status(401).json({
          success: false,
          message: 'Authentication required',
          code: 'AUTH_REQUIRED'
        });
      }

      // Get subaccount details - include encrypted fields for service requests
      let subaccount;
      if (needsMongoUrl) {
        // For service requests, we need the encrypted fields to decrypt the URL
        subaccount = await Subaccount.findById(subaccountId)
          .select('+mongodbUrl +encryptionIV +encryptionAuthTag')
          .populate('retellAccountId', 'accountName isActive verificationStatus lastVerified')
          .populate({
            path: 'activatedConnectors.connectorId',
            select: 'type name description icon category version isActive'
          });
      } else {
        subaccount = await Subaccount.findById(subaccountId)
          .populate('retellAccountId', 'accountName isActive verificationStatus lastVerified')
          .populate({
            path: 'activatedConnectors.connectorId',
            select: 'type name description icon category version isActive'
          });
      }
      
      if (!subaccount) {
        return res.status(404).json({
          success: false,
          message: 'Subaccount not found',
          code: 'SUBACCOUNT_NOT_FOUND'
        });
      }

      // Get user count for this subaccount
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
        
        // Retell account info
        retellAccount: subaccount.retellAccountId ? {
          id: subaccount.retellAccountId._id,
          accountName: subaccount.retellAccountId.accountName,
          isActive: subaccount.retellAccountId.isActive,
          verificationStatus: subaccount.retellAccountId.verificationStatus,
          lastVerified: subaccount.retellAccountId.lastVerified
        } : null,
        
        // Activated connectors (without sensitive config)
        activatedConnectors: subaccount.activatedConnectors
          .filter(ac => ac.connectorId) // Filter out any null/undefined connectors
          .map(ac => ({
            id: ac._id,
            type: ac.connectorId.type,
            name: ac.connectorId.name,
            description: ac.connectorId.description,
            icon: ac.connectorId.icon,
            category: ac.connectorId.category,
            version: ac.connectorId.version,
            isActive: ac.isActive,
            activatedAt: ac.activatedAt,
            connectorBaseActive: ac.connectorId.isActive // Base connector status
          })),
        
        // User-specific data
        userRole: userRole,
        userPermissions: userSubaccount ? userSubaccount.permissions : (req.subaccount?.permissions || {
          read: true,
          write: true,
          delete: true,
          admin: true
        }),
        userStats: userSubaccount ? userSubaccount.stats : {
          totalQueries: 0,
          totalDocumentsRead: 0,
          totalDocumentsWritten: 0,
          avgResponseTime: 0
        },
        joinedAt: userSubaccount ? userSubaccount.createdAt : null,
        lastAccessed: userSubaccount ? userSubaccount.lastAccessed : null
      };

      // Include encrypted MongoDB URL and decryption data for service requests
      if (needsMongoUrl && subaccount.mongodbUrl) {
        result.mongodbUrl = subaccount.mongodbUrl; // Keep encrypted
        result.encryptionIV = subaccount.encryptionIV;
        result.encryptionAuthTag = subaccount.encryptionAuthTag;
        Logger.debug('MongoDB URL encryption data provided for service request', { 
          subaccountId, 
          serviceName: serviceName || 'unknown' 
        });
      }

      // Cache the result (without MongoDB URL for security)
      if (!needsMongoUrl) {
        await redisService.cacheSubaccount(subaccountId, result, 3600);
      }

      Logger.info('Subaccount details retrieved', {
        userId,
        serviceName,
        subaccountId,
        role: userRole,
        isServiceRequest,
        includesMongoUrl: needsMongoUrl && !!result.mongodbUrl
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
        serviceName: req.service?.serviceName,
        isServiceRequest: !!req.service,
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

      // Get Redis service instance (dynamic)
      const redisService = redisManager.getRedisService();

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
      if (!SubaccountController.validateMongoUrl(mongodbUrl)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid MongoDB URL format',
          code: 'INVALID_MONGODB_URL'
        });
      }

      if (!SubaccountController.isHostAllowed(mongodbUrl)) {
        Logger.security('Unauthorized MongoDB host', 'high', {
          userId,
          mongodbUrl: SubaccountController.maskConnectionString(mongodbUrl)
        });

        return res.status(403).json({
          success: false,
          message: 'MongoDB host not allowed',
          code: 'HOST_NOT_ALLOWED'
        });
      }

      // Create subaccount (simplified without transaction for now)
      try {
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

        await subaccount.save();
        console.log('[DEBUG] Subaccount saved with ID:', subaccount._id);

        // Create user-subaccount relationship with owner permissions
        const userSubaccount = new UserSubaccount({
          userId,
          subaccountId: subaccount._id,
          role: 'owner',
          permissions: {
            read: true,
            write: true,
            delete: true,
            admin: true
          },
          invitedBy: userId,
          invitedAt: new Date(),
          acceptedAt: new Date()
        });

        await userSubaccount.save();
        console.log('[DEBUG] UserSubaccount relationship created');

        // Update user subaccount count
        await User.findByIdAndUpdate(
          userId,
          { $inc: { subaccountCount: 1 } }
        );
        console.log('[DEBUG] User subaccount count updated');

        const result = { subaccount, userSubaccount };

        // Invalidate user cache
        if (redisService && redisService.isConnected) {
          try {
            await redisService.invalidateUserSubaccounts(userId);
          } catch (cacheError) {
            Logger.warn('Failed to invalidate cache', { error: cacheError.message });
          }
        }

        Logger.info('Subaccount created successfully', {
          userId,
          subaccountId: result.subaccount._id,
          name,
          databaseName,
          allowedCollections
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

      // Get Redis service instance (dynamic)
      const redisService = redisManager.getRedisService();

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

      // Get Redis service instance (dynamic)
      const redisService = redisManager.getRedisService();

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

      // Get Redis service instance (dynamic)
      const redisService = redisManager.getRedisService();

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

  // Invite email for calendar integration
  static async inviteEmailForCalendar(req, res, next) {
    try {
      const { subaccountId } = req.params;
      const { userEmail } = req.body;
      const userId = req.user?.id;

      if (!userEmail) {
        return res.status(400).json({
          success: false,
          message: 'User email is required',
          code: 'EMAIL_REQUIRED'
        });
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(userEmail)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid email format',
          code: 'INVALID_EMAIL'
        });
      }

      Logger.audit('Invite email for calendar integration', 'calendar_integration', {
        userId,
        subaccountId,
        userEmail
      });

      // Verify subaccount exists
      const subaccount = await Subaccount.findById(subaccountId);
      if (!subaccount) {
        return res.status(404).json({
          success: false,
          message: 'Subaccount not found',
          code: 'SUBACCOUNT_NOT_FOUND'
        });
      }

      if (!subaccount.isActive) {
        return res.status(400).json({
          success: false,
          message: 'Subaccount is not active',
          code: 'SUBACCOUNT_INACTIVE'
        });
      }

      
      // Call webhook service to invite email
      const inviteResult = await webhookService.inviteEmailForCalendarIntegration(
        subaccountId,
        userEmail
      );

      if (inviteResult.success) {
        Logger.info('Email invited for calendar integration', {
          userId,
          subaccountId,
          userEmail,
          authUrl: inviteResult.authUrl
        });

        return res.status(200).json({
          success: true,
          message: inviteResult.message || 'Email invited successfully',
          data: {
            authUrl: inviteResult.authUrl,
            userEmail
          }
        });
      } else {
        Logger.warn('Failed to invite email for calendar integration', {
          userId,
          subaccountId,
          userEmail,
          message: inviteResult.message
        });

        return res.status(400).json({
          success: false,
          message: inviteResult.message || 'Failed to invite email',
          code: 'INVITATION_FAILED'
        });
      }

    } catch (error) {
      Logger.error('Failed to invite email for calendar integration', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
        subaccountId: req.params.subaccountId
      });
      next(error);
    }
  }

  // Invalidate subaccount cache
  static async invalidateCache(req, res, next) {
    try {
      const { subaccountId } = req.params;
      const userId = req.user?.id;

      Logger.audit('Invalidate subaccount cache', 'cache', {
        userId,
        subaccountId
      });

      // Get Redis service instance
      const redisService = redisManager.getRedisService();

      if (!redisService || !redisService.isConnected) {
        return res.status(503).json({
          success: false,
          message: 'Cache service unavailable',
          code: 'CACHE_UNAVAILABLE'
        });
      }

      // Invalidate the subaccount cache
      await redisService.invalidateSubaccount(subaccountId);

      // Also invalidate user subaccounts cache if userId is available
      if (userId) {
        try {
          await redisService.invalidateUserSubaccounts(userId);
        } catch (error) {
          Logger.warn('Failed to invalidate user subaccounts cache', {
            userId,
            error: error.message
          });
        }
      }

      Logger.info('Subaccount cache invalidated', {
        userId,
        subaccountId
      });

      res.json({
        success: true,
        message: 'Cache invalidated successfully',
        data: {
          subaccountId,
          invalidatedAt: new Date()
        }
      });

    } catch (error) {
      Logger.error('Failed to invalidate cache', {
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