const mongoose = require('mongoose');
const config = require('../../config/config');
const Logger = require('../utils/logger');
const redisManager = require('../services/redisManager');
const Database = require('../utils/database');
const webhookService = require('../services/webhookService');
const RetellSDK = require('retell-sdk').Retell;

// Import models
const Subaccount = require('../models/Subaccount');
const UserSubaccount = require('../models/UserSubaccount');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const Connector = require('../models/Connector');
const RetellAccount = require('../models/RetellAccount');

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

      // Check if user is a global admin or super_admin
      const isGlobalAdmin = req.user && (req.user.role === 'admin' || req.user.role === 'super_admin');

      // Get user subaccounts with pagination and timeout
      const skip = (page - 1) * limit;
      
      // Add timeout to prevent hanging queries
      const queryTimeout = 15000; // 15 seconds
      
      Logger.debug('Executing database query', { isGlobalAdmin, skip, limit, queryTimeout });
      
      try {
        let result;
        
        if (isGlobalAdmin) {
          // Global admins see all subaccounts (active by default unless status param is set)
          const subaccountQuery = {};
          // Default to showing only active subaccounts unless status query param is explicitly set
          if (status !== undefined) {
            // If status param is provided, use it explicitly
            subaccountQuery.isActive = status === 'active';
          } else {
            // Default: show only active subaccounts
            subaccountQuery.isActive = true;
          }
          
          const [subaccounts, total] = await Promise.race([
            Promise.all([
              Subaccount.find(subaccountQuery)
                .select('name description isActive stats createdAt maintenanceMode rateLimits activatedConnectors createdBy')
                .populate({
                  path: 'activatedConnectors.connectorId',
                  select: 'type name icon category'
                })
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit))
                .maxTimeMS(queryTimeout),
              Subaccount.countDocuments(subaccountQuery).maxTimeMS(queryTimeout)
            ]),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Database query timeout')), queryTimeout + 1000)
            )
          ]);

          Logger.debug('Global admin query completed', { 
            subaccountsCount: subaccounts.length, 
            total,
            duration: Date.now() - startTime 
          });

          result = {
            subaccounts: subaccounts.map(subaccount => ({
              id: subaccount._id,
              name: subaccount.name,
              description: subaccount.description,
              isActive: subaccount.isActive,
              maintenanceMode: subaccount.maintenanceMode,
              role: 'admin', // Global admins have admin role on all subaccounts
              permissions: {
                read: true,
                write: true,
                delete: true,
                admin: true
              },
              stats: subaccount.stats,
              rateLimits: subaccount.rateLimits,
              joinedAt: subaccount.createdAt,
              lastAccessed: null,
              userStats: {
                totalQueries: 0,
                totalDocumentsRead: 0,
                totalDocumentsWritten: 0,
                avgResponseTime: 0
              },
              activatedConnectors: subaccount.activatedConnectors
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
        } else {
          // Regular users see only their linked subaccounts
          const query = { userId, isActive: true };
          if (role) query.role = role;

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

          Logger.debug('User query completed', { 
            userSubaccountsCount: userSubaccounts.length, 
            total,
            duration: Date.now() - startTime 
          });

          // Filter out null subaccounts (from populate match)
          const validSubaccounts = userSubaccounts.filter(us => us.subaccountId);
          console.log('[DEBUG] Filtered subaccounts', { validCount: validSubaccounts.length });

          result = {
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
        }

        const duration = Date.now() - startTime;
        Logger.info('User subaccounts retrieved', {
          userId,
          count: result.subaccounts.length,
          total: result.pagination.total,
          duration: `${duration}ms`,
          isGlobalAdmin
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
          queryParams: req.query,
          isGlobalAdmin,
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

      // Auto-generate MongoDB URL if not provided
      let finalMongodbUrl = mongodbUrl;
      if (!finalMongodbUrl || finalMongodbUrl.trim() === '') {
        try {
          Logger.info('Auto-generating MongoDB URL from admin connection', {
            userId,
            databaseName
          });
          
          finalMongodbUrl = SubaccountController.buildMongoUrlFromAdminConnection(databaseName);
          
          Logger.info('MongoDB URL auto-generated successfully', {
            userId,
            databaseName,
            maskedUrl: SubaccountController.maskConnectionString(finalMongodbUrl)
          });

          // Optionally test the connection (lightweight verification)
          try {
            await SubaccountController.testMongoConnection(finalMongodbUrl, databaseName);
            Logger.debug('MongoDB connection test passed', {
              userId,
              databaseName
            });
          } catch (testError) {
            // Log warning but don't fail - database will be created on first write
            Logger.warn('MongoDB connection test failed (non-critical)', {
              error: testError.message,
              userId,
              databaseName,
              note: 'Database will be created automatically on first write'
            });
          }
        } catch (error) {
          Logger.error('Failed to auto-generate MongoDB URL', {
            error: error.message,
            userId,
            databaseName
          });
          
          return res.status(500).json({
            success: false,
            message: 'Failed to auto-generate MongoDB URL. Please provide mongodbUrl explicitly.',
            code: 'MONGODB_URL_GENERATION_FAILED',
            error: error.message
          });
        }
      }

      // Validate MongoDB URL format and allowed hosts
      if (!SubaccountController.validateMongoUrl(finalMongodbUrl)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid MongoDB URL format',
          code: 'INVALID_MONGODB_URL'
        });
      }

      if (!SubaccountController.isHostAllowed(finalMongodbUrl)) {
        Logger.security('Unauthorized MongoDB host', 'high', {
          userId,
          mongodbUrl: SubaccountController.maskConnectionString(finalMongodbUrl)
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
          mongodbUrl: finalMongodbUrl, // Will be encrypted by pre-save middleware
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

        // Invalidate caches
        if (redisService && redisService.isConnected) {
          try {
            Logger.info('Starting cache invalidation after subaccount creation', {
              userId,
              subaccountId: subaccount._id.toString(),
              redisConnected: redisService.isConnected
            });
            
            // Invalidate ALL user subaccount caches (most aggressive approach)
            // This ensures all users (including global admins) see the new subaccount immediately
            const allKeysDeleted = await redisService.invalidateAllUserSubaccounts();
            Logger.info('Invalidated all user subaccount caches', { 
              keysDeleted: allKeysDeleted,
              userId,
              subaccountId: subaccount._id.toString()
            });
            
            // Also invalidate the specific subaccount cache
            const subaccountInvalidation = await redisService.invalidateSubaccount(subaccount._id.toString());
            Logger.info('Invalidated subaccount cache', { 
              subaccountId: subaccount._id.toString(), 
              result: subaccountInvalidation,
              userId
            });
            
            // Invalidate subaccount users cache for the new subaccount
            const usersKeysDeleted = await redisService.invalidateSubaccountUsers(subaccount._id.toString());
            Logger.info('Invalidated subaccount users cache', { 
              subaccountId: subaccount._id.toString(), 
              keysDeleted: usersKeysDeleted,
              userId
            });
            
            // Also directly invalidate the creator's cache as a fallback
            const creatorKeysDeleted = await redisService.invalidateUserSubaccounts(userId);
            Logger.info('Invalidated creator cache as fallback', { 
              userId,
              keysDeleted: creatorKeysDeleted
            });
            
            Logger.info('All caches invalidated after subaccount creation', {
              userId,
              subaccountId: subaccount._id.toString(),
              allUserSubaccountKeysDeleted: allKeysDeleted,
              subaccountKeysDeleted: subaccountInvalidation?.globalAdminKeys || 0,
              usersKeysDeleted,
              creatorKeysDeleted
            });
          } catch (cacheError) {
            Logger.error('Failed to invalidate cache', { 
              error: cacheError.message,
              stack: cacheError.stack,
              userId,
              subaccountId: subaccount._id.toString()
            });
          }
        } else {
          Logger.warn('Redis not connected, skipping cache invalidation', {
            hasRedisService: !!redisService,
            isConnected: redisService ? redisService.isConnected : false,
            userId,
            subaccountId: subaccount._id.toString()
          });
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
      if (redisService && redisService.isConnected) {
        try {
          await Promise.all([
            redisService.invalidateSubaccount(subaccountId),
            redisService.invalidateSubaccountUsers(subaccountId),
            redisService.invalidateUserSubaccounts(userId)
          ]);
        } catch (cacheError) {
          Logger.warn('Failed to invalidate cache', { error: cacheError.message });
        }
      }

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

  // Delete subaccount (hard delete - removes from MongoDB)
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

      // Check if user is a global admin or super_admin (they have access to all subaccounts)
      const isGlobalAdmin = req.user && (req.user.role === 'admin' || req.user.role === 'super_admin');

      // Check if user is owner or admin of this specific subaccount
      let userSubaccount = null;
      if (!isGlobalAdmin) {
        userSubaccount = await UserSubaccount.findOne({
          userId,
          subaccountId,
          role: { $in: ['owner', 'admin'] },
          isActive: true
        });

        if (!userSubaccount) {
          return res.status(403).json({
            success: false,
            message: 'Only subaccount owner or admin can delete subaccount',
            code: 'INSUFFICIENT_PERMISSIONS'
          });
        }
      }

      // Get subaccount with encrypted fields before deletion (needed for database deletion)
      const subaccount = await Subaccount.findById(subaccountId)
        .select('+mongodbUrl +encryptionIV +encryptionAuthTag databaseName');
      
      if (!subaccount) {
        return res.status(404).json({
          success: false,
          message: 'Subaccount not found',
          code: 'SUBACCOUNT_NOT_FOUND'
        });
      }

      // Delete the MongoDB database associated with this subaccount
      let dbConnection = null;
      try {
        const decryptedUrl = subaccount.getDecryptedUrl();
        const databaseName = subaccount.databaseName;
        
        Logger.info('Deleting MongoDB database for subaccount', {
          subaccountId,
          databaseName,
          maskedUrl: SubaccountController.maskConnectionString(decryptedUrl)
        });

        // Create a connection to the subaccount's MongoDB instance
        // Ensure we connect to the specific database by including it in the connection options
        dbConnection = await mongoose.createConnection(decryptedUrl, {
          dbName: databaseName, // Explicitly specify the database name
          serverSelectionTimeoutMS: 10000,
          connectTimeoutMS: 10000,
          maxPoolSize: 1,
          minPoolSize: 0
        });

        // Wait for connection to be ready
        await new Promise((resolve, reject) => {
          dbConnection.once('connected', resolve);
          dbConnection.once('error', reject);
          setTimeout(() => reject(new Error('Connection timeout')), 10000);
        });

        // Drop the database
        // This will drop the database that the connection is currently using
        const db = dbConnection.db;
        await db.dropDatabase();
        
        Logger.debug('Database drop command executed', {
          subaccountId,
          databaseName,
          dbName: db.databaseName
        });
        
        Logger.info('MongoDB database deleted successfully', {
          subaccountId,
          databaseName
        });
      } catch (dbError) {
        Logger.error('Failed to delete MongoDB database', {
          error: dbError.message,
          stack: dbError.stack,
          subaccountId,
          databaseName: subaccount.databaseName
        });
        // Continue with subaccount deletion even if database deletion fails
      } finally {
        // Close the database connection
        if (dbConnection) {
          try {
            await dbConnection.close();
          } catch (closeError) {
            Logger.warn('Error closing database connection', {
              error: closeError.message,
              subaccountId
            });
          }
        }
      }

      // Delete Retell resources (agents, phone numbers, knowledge bases) but keep RetellAccount
      try {
        const retellAccount = await RetellAccount.findOne({ subaccountId })
          .select('+apiKey +encryptionIV +encryptionAuthTag');
        
        if (retellAccount && retellAccount.isActive) {
          Logger.info('Deleting Retell resources for subaccount', {
            subaccountId,
            retellAccountId: retellAccount._id
          });

          // Decrypt API key
          const decryptedApiKey = retellAccount.getDecryptedApiKey();
          
          // Create Retell SDK client
          const retellClient = new RetellSDK({
            apiKey: decryptedApiKey
          });

          // Delete all agents
          try {
            const agents = await retellClient.agent.list();
            Logger.info('Found agents to delete', {
              subaccountId,
              agentCount: agents?.length || 0
            });
            
            for (const agent of agents || []) {
              try {
                await retellClient.agent.delete(agent.agent_id);
                Logger.debug('Deleted agent from Retell', {
                  subaccountId,
                  agentId: agent.agent_id,
                  agentName: agent.agent_name
                });
              } catch (agentError) {
                Logger.warn('Failed to delete agent from Retell', {
                  subaccountId,
                  agentId: agent.agent_id,
                  error: agentError.message
                });
              }
            }
          } catch (agentsError) {
            Logger.warn('Failed to list/delete agents from Retell', {
              subaccountId,
              error: agentsError.message
            });
          }

          // Delete all phone numbers
          try {
            const phoneNumbers = await retellClient.phoneNumber.list();
            Logger.info('Found phone numbers to delete', {
              subaccountId,
              phoneNumberCount: phoneNumbers?.length || 0
            });
            
            for (const phoneNumber of phoneNumbers || []) {
              try {
                await retellClient.phoneNumber.delete(phoneNumber.phone_number_id);
                Logger.debug('Deleted phone number from Retell', {
                  subaccountId,
                  phoneNumberId: phoneNumber.phone_number_id,
                  phoneNumber: phoneNumber.phone_number
                });
              } catch (phoneError) {
                Logger.warn('Failed to delete phone number from Retell', {
                  subaccountId,
                  phoneNumberId: phoneNumber.phone_number_id,
                  error: phoneError.message
                });
              }
            }
          } catch (phoneNumbersError) {
            Logger.warn('Failed to list/delete phone numbers from Retell', {
              subaccountId,
              error: phoneNumbersError.message
            });
          }

          // Delete all knowledge bases
          try {
            const knowledgeBases = await retellClient.knowledgeBase.list();
            Logger.info('Found knowledge bases to delete', {
              subaccountId,
              knowledgeBaseCount: knowledgeBases?.length || 0
            });
            
            for (const kb of knowledgeBases || []) {
              try {
                await retellClient.knowledgeBase.delete(kb.knowledge_base_id);
                Logger.debug('Deleted knowledge base from Retell', {
                  subaccountId,
                  knowledgeBaseId: kb.knowledge_base_id,
                  knowledgeBaseName: kb.knowledge_base_name
                });
              } catch (kbError) {
                Logger.warn('Failed to delete knowledge base from Retell', {
                  subaccountId,
                  knowledgeBaseId: kb.knowledge_base_id,
                  error: kbError.message
                });
              }
            }
          } catch (kbError) {
            Logger.warn('Failed to list/delete knowledge bases from Retell', {
              subaccountId,
              error: kbError.message
            });
          }

          // Delete all call logs
          try {
            // List all calls with maximum limit (Retell API supports up to 1000 per request)
            const calls = await retellClient.call.list({ limit: 1000 });
            const callList = Array.isArray(calls) ? calls : [];
            
            Logger.info('Found call logs to delete', {
              subaccountId,
              callCount: callList.length
            });
            
            // Delete each call log
            for (const call of callList) {
              try {
                await retellClient.call.delete(call.call_id);
                Logger.debug('Deleted call log from Retell', {
                  subaccountId,
                  callId: call.call_id,
                  agentId: call.agent_id
                });
              } catch (callError) {
                Logger.warn('Failed to delete call log from Retell', {
                  subaccountId,
                  callId: call.call_id,
                  error: callError.message
                });
              }
            }
            
            // Note: If there are more than 1000 calls, we'd need pagination
            // For now, this handles the common case. If needed, pagination can be added later.
            if (callList.length === 1000) {
              Logger.warn('Reached call log limit (1000), there may be more calls to delete', {
                subaccountId
              });
            }
          } catch (callsError) {
            Logger.warn('Failed to list/delete call logs from Retell', {
              subaccountId,
              error: callsError.message
            });
          }

          Logger.info('Retell resources deletion completed', {
            subaccountId,
            retellAccountId: retellAccount._id
          });
        } else {
          Logger.debug('No active RetellAccount found, skipping Retell resource deletion', {
            subaccountId,
            hasRetellAccount: !!retellAccount,
            isActive: retellAccount?.isActive
          });
        }
      } catch (retellError) {
        Logger.error('Failed to delete Retell resources', {
          error: retellError.message,
          stack: retellError.stack,
          subaccountId
        });
        // Continue with subaccount deletion even if Retell deletion fails
      }

      // Use transaction for atomic operation
      let affectedUserIds = [];
      await Database.withTransaction(async (session) => {
        // Get all users associated with this subaccount before deletion (for updating counts)
        const allUserSubaccounts = await UserSubaccount.find({ subaccountId }).session(session);
        affectedUserIds = [...new Set(allUserSubaccounts.map(us => us.userId.toString()))];

        // Note: RetellAccount is NOT deleted - it's kept for potential reuse

        // Hard delete all user-subaccount relationships
        await UserSubaccount.deleteMany({ subaccountId }).session(session);

        // Hard delete subaccount
        await Subaccount.findByIdAndDelete(subaccountId).session(session);

        // Update subaccount count for all affected users
        for (const affectedUserId of affectedUserIds) {
          const activeSubaccountCount = await UserSubaccount.countDocuments({
            userId: affectedUserId,
            isActive: true
          }).session(session);
          
          await User.findByIdAndUpdate(
            affectedUserId,
            { subaccountCount: activeSubaccountCount }
          ).session(session);
        }
      });

      // Invalidate all related caches
      if (redisService && redisService.isConnected) {
        try {
          // Invalidate caches for all affected users
          await Promise.all([
            redisService.invalidateSubaccount(subaccountId),
            redisService.invalidateSubaccountUsers(subaccountId),
            ...affectedUserIds.map(userId => redisService.invalidateUserSubaccounts(userId))
          ]);
        } catch (cacheError) {
          Logger.warn('Failed to invalidate cache', { error: cacheError.message });
        }
      }

      Logger.security('Subaccount deleted', 'high', {
        userId,
        subaccountId,
        action: 'hard_delete',
        affectedUsers: affectedUserIds.length
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

      // Invalidate subaccount users cache
      try {
        await redisService.invalidateSubaccountUsers(subaccountId);
        Logger.debug('Invalidated subaccount users cache', { subaccountId });
      } catch (error) {
        Logger.warn('Failed to invalidate subaccount users cache', {
          subaccountId,
          error: error.message
        });
      }

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
  /**
   * Test MongoDB connection (lightweight verification)
   * @param {string} mongodbUrl - MongoDB connection URL to test
   * @param {string} databaseName - Database name to verify
   * @returns {Promise<void>}
   */
  static async testMongoConnection(mongodbUrl, databaseName) {
    let testConnection = null;
    try {
      // Create a temporary connection to test
      testConnection = mongoose.createConnection(mongodbUrl, {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
        socketTimeoutMS: 5000
      });

      // Wait for connection to be established
      await new Promise((resolve, reject) => {
        // Check if already connected
        if (testConnection.readyState === 1) {
          resolve();
          return;
        }

        const timeout = setTimeout(() => {
          reject(new Error('Connection timeout'));
        }, 5000);

        testConnection.once('connected', () => {
          clearTimeout(timeout);
          resolve();
        });

        testConnection.once('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      // Verify we can access the database (listCollections is lightweight)
      const db = testConnection.db;
      await db.listCollections().toArray();

      Logger.debug('MongoDB connection test successful', {
        databaseName,
        host: testConnection.host
      });
    } catch (error) {
      Logger.warn('MongoDB connection test failed', {
        error: error.message,
        databaseName
      });
      throw error;
    } finally {
      // Clean up test connection
      if (testConnection) {
        try {
          await testConnection.close();
        } catch (closeError) {
          Logger.warn('Error closing test connection', {
            error: closeError.message
          });
        }
      }
    }
  }

  /**
   * Build MongoDB URL from admin connection by replacing database name
   * @param {string} databaseName - The database name to use in the connection URL
   * @returns {string} - Constructed MongoDB URL
   */
  static buildMongoUrlFromAdminConnection(databaseName) {
    try {
      const adminMongoUri = config.database.mongoUri;
      
      if (!adminMongoUri) {
        throw new Error('Admin MongoDB URI is not configured');
      }

      // Parse the admin MongoDB URL
      const url = new URL(adminMongoUri);
      
      // Remove existing database name from pathname if present
      // MongoDB URLs have format: mongodb://host:port/database?options
      // We want to replace the database part with the new databaseName
      const pathParts = url.pathname.split('/').filter(part => part.length > 0);
      
      // Set the new database name as the pathname
      // If pathname was empty or just '/', we'll set it to '/databaseName'
      url.pathname = `/${databaseName}`;
      
      // Reconstruct the URL
      // Note: URL.toString() will properly encode the URL
      const constructedUrl = url.toString();
      
      Logger.debug('Built MongoDB URL from admin connection', {
        databaseName,
        adminHost: url.hostname,
        constructedUrl: this.maskConnectionString(constructedUrl)
      });
      
      return constructedUrl;
    } catch (error) {
      Logger.error('Failed to build MongoDB URL from admin connection', {
        error: error.message,
        stack: error.stack,
        databaseName
      });
      throw new Error(`Failed to build MongoDB URL: ${error.message}`);
    }
  }

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