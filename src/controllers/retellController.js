const mongoose = require('mongoose');
const Logger = require('../utils/logger');
const redisManager = require('../services/redisManager');

// Import models
const RetellAccount = require('../models/RetellAccount');
const Subaccount = require('../models/Subaccount');
const UserSubaccount = require('../models/UserSubaccount');

class RetellController {
  // Get retell account for a subaccount
  static async getRetellAccount(req, res, next) {
    try {
      const { subaccountId } = req.params;
      const userId = req.user?.id;
      const isServiceRequest = !!req.service;

      Logger.audit('Get retell account', 'retell', {
        userId,
        subaccountId,
        isServiceRequest
      });

      // Check if this is a service request
      const needsApiKey = isServiceRequest || 
                         req.headers['x-service-name'] === 'database-server' || 
                         req.user?.role === 'super_admin';

      // Find retell account
      let retellAccount;
      if (needsApiKey) {
        retellAccount = await RetellAccount.findOne({ subaccountId })
          .select('+apiKey +encryptionIV +encryptionAuthTag');
      } else {
        retellAccount = await RetellAccount.findOne({ subaccountId });
      }

      if (!retellAccount) {
        return res.status(404).json({
          success: false,
          message: 'Retell account not found for this subaccount',
          code: 'RETELL_ACCOUNT_NOT_FOUND'
        });
      }

      const result = {
        id: retellAccount._id,
        accountName: retellAccount.accountName,
        isActive: retellAccount.isActive,
        subaccountId: retellAccount.subaccountId,
        verificationStatus: retellAccount.verificationStatus,
        lastVerified: retellAccount.lastVerified,
        createdAt: retellAccount.createdAt,
        updatedAt: retellAccount.updatedAt
      };

      // Include encrypted API key for service requests
      if (needsApiKey && retellAccount.apiKey) {
        result.apiKey = retellAccount.apiKey; // Keep encrypted
        result.encryptionIV = retellAccount.encryptionIV;
        result.encryptionAuthTag = retellAccount.encryptionAuthTag;
        Logger.debug('API key encryption data provided for service request', { 
          subaccountId,
          serviceName: req.service?.serviceName || 'unknown'
        });
      }

      Logger.info('Retell account retrieved', {
        userId,
        subaccountId,
        retellAccountId: retellAccount._id,
        includesApiKey: needsApiKey && !!result.apiKey
      });

      res.json({
        success: true,
        message: 'Retell account retrieved successfully',
        data: result
      });

    } catch (error) {
      Logger.error('Failed to get retell account', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
        subaccountId: req.params.subaccountId
      });
      next(error);
    }
  }

  // Create or update retell account for a subaccount
  static async upsertRetellAccount(req, res, next) {
    try {
      const { subaccountId } = req.params;
      const userId = req.user.id;
      const { apiKey, accountName } = req.body;

      Logger.audit('Upsert retell account', 'retell', {
        userId,
        subaccountId,
        accountName
      });

      // Get Redis service instance (dynamic)
      const redisService = redisManager.getRedisService();

      // Verify user has admin permissions
      const userSubaccount = await UserSubaccount.findOne({
        userId,
        subaccountId,
        isActive: true
      });

      if (!userSubaccount || !userSubaccount.hasPermission('admin')) {
        return res.status(403).json({
          success: false,
          message: 'Admin permissions required to manage retell account',
          code: 'INSUFFICIENT_PERMISSIONS'
        });
      }

      // Verify subaccount exists
      const subaccount = await Subaccount.findById(subaccountId);
      if (!subaccount) {
        return res.status(404).json({
          success: false,
          message: 'Subaccount not found',
          code: 'SUBACCOUNT_NOT_FOUND'
        });
      }

      // Check if retell account already exists
      let retellAccount = await RetellAccount.findOne({ subaccountId });
      let isNew = false;

      if (retellAccount) {
        // Update existing retell account
        retellAccount.apiKey = apiKey;
        if (accountName !== undefined) {
          retellAccount.accountName = accountName;
        }
        retellAccount.verificationStatus = 'pending';
        await retellAccount.save();
        
        Logger.info('Retell account updated', {
          userId,
          subaccountId,
          retellAccountId: retellAccount._id
        });
      } else {
        // Create new retell account
        retellAccount = new RetellAccount({
          apiKey, // Will be encrypted by pre-save middleware
          accountName,
          subaccountId,
          createdBy: userId,
          isActive: true,
          verificationStatus: 'pending'
        });
        
        await retellAccount.save();
        isNew = true;

        // Update subaccount reference
        await Subaccount.findByIdAndUpdate(
          subaccountId,
          { retellAccountId: retellAccount._id }
        );

        Logger.info('Retell account created', {
          userId,
          subaccountId,
          retellAccountId: retellAccount._id
        });
      }

      // Invalidate caches
      if (redisService && redisService.isConnected) {
        try {
          await Promise.all([
            redisService.invalidateSubaccount(subaccountId),
            redisService.invalidateUserSubaccounts(userId)
          ]);
        } catch (cacheError) {
          Logger.warn('Failed to invalidate cache', { error: cacheError.message });
        }
      }

      const response = {
        id: retellAccount._id,
        accountName: retellAccount.accountName,
        isActive: retellAccount.isActive,
        subaccountId: retellAccount.subaccountId,
        verificationStatus: retellAccount.verificationStatus,
        lastVerified: retellAccount.lastVerified,
        createdAt: retellAccount.createdAt,
        updatedAt: retellAccount.updatedAt
      };

      res.status(isNew ? 201 : 200).json({
        success: true,
        message: isNew ? 'Retell account created successfully' : 'Retell account updated successfully',
        data: response
      });

    } catch (error) {
      Logger.error('Failed to upsert retell account', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
        subaccountId: req.params.subaccountId
      });

      // Handle unique constraint errors
      if (error.code === 11000) {
        return res.status(400).json({
          success: false,
          message: 'Retell account already exists for this subaccount',
          code: 'DUPLICATE_RETELL_ACCOUNT'
        });
      }
      
      next(error);
    }
  }

  // Update retell account (partial update)
  static async updateRetellAccount(req, res, next) {
    try {
      const { subaccountId } = req.params;
      const userId = req.user.id;
      const updates = req.body;

      Logger.audit('Update retell account', 'retell', {
        userId,
        subaccountId,
        updates: Object.keys(updates)
      });

      // Get Redis service instance (dynamic)
      const redisService = redisManager.getRedisService();

      // Verify user has admin permissions
      const userSubaccount = await UserSubaccount.findOne({
        userId,
        subaccountId,
        isActive: true
      });

      if (!userSubaccount || !userSubaccount.hasPermission('admin')) {
        return res.status(403).json({
          success: false,
          message: 'Admin permissions required to manage retell account',
          code: 'INSUFFICIENT_PERMISSIONS'
        });
      }

      // Find retell account
      const retellAccount = await RetellAccount.findOne({ subaccountId });

      if (!retellAccount) {
        return res.status(404).json({
          success: false,
          message: 'Retell account not found for this subaccount',
          code: 'RETELL_ACCOUNT_NOT_FOUND'
        });
      }

      // Update fields
      if (updates.apiKey !== undefined) {
        retellAccount.apiKey = updates.apiKey;
        retellAccount.verificationStatus = 'pending';
      }
      if (updates.accountName !== undefined) {
        retellAccount.accountName = updates.accountName;
      }
      if (updates.isActive !== undefined) {
        retellAccount.isActive = updates.isActive;
      }

      await retellAccount.save();

      // Invalidate caches
      if (redisService && redisService.isConnected) {
        try {
          await Promise.all([
            redisService.invalidateSubaccount(subaccountId),
            redisService.invalidateUserSubaccounts(userId)
          ]);
        } catch (cacheError) {
          Logger.warn('Failed to invalidate cache', { error: cacheError.message });
        }
      }

      Logger.info('Retell account updated', {
        userId,
        subaccountId,
        retellAccountId: retellAccount._id,
        updatedFields: Object.keys(updates)
      });

      const response = {
        id: retellAccount._id,
        accountName: retellAccount.accountName,
        isActive: retellAccount.isActive,
        subaccountId: retellAccount.subaccountId,
        verificationStatus: retellAccount.verificationStatus,
        lastVerified: retellAccount.lastVerified,
        createdAt: retellAccount.createdAt,
        updatedAt: retellAccount.updatedAt
      };

      res.json({
        success: true,
        message: 'Retell account updated successfully',
        data: response
      });

    } catch (error) {
      Logger.error('Failed to update retell account', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
        subaccountId: req.params.subaccountId
      });
      next(error);
    }
  }

  // Delete retell account
  static async deleteRetellAccount(req, res, next) {
    try {
      const { subaccountId } = req.params;
      const userId = req.user.id;

      Logger.audit('Delete retell account', 'retell', {
        userId,
        subaccountId
      });

      // Get Redis service instance (dynamic)
      const redisService = redisManager.getRedisService();

      // Verify user has admin permissions
      const userSubaccount = await UserSubaccount.findOne({
        userId,
        subaccountId,
        isActive: true
      });

      if (!userSubaccount || !userSubaccount.hasPermission('admin')) {
        return res.status(403).json({
          success: false,
          message: 'Admin permissions required to delete retell account',
          code: 'INSUFFICIENT_PERMISSIONS'
        });
      }

      // Find and delete retell account
      const retellAccount = await RetellAccount.findOneAndDelete({ subaccountId });

      if (!retellAccount) {
        return res.status(404).json({
          success: false,
          message: 'Retell account not found for this subaccount',
          code: 'RETELL_ACCOUNT_NOT_FOUND'
        });
      }

      // Remove reference from subaccount
      await Subaccount.findByIdAndUpdate(
        subaccountId,
        { $unset: { retellAccountId: 1 } }
      );

      // Invalidate caches
      if (redisService && redisService.isConnected) {
        try {
          await Promise.all([
            redisService.invalidateSubaccount(subaccountId),
            redisService.invalidateUserSubaccounts(userId)
          ]);
        } catch (cacheError) {
          Logger.warn('Failed to invalidate cache', { error: cacheError.message });
        }
      }

      Logger.security('Retell account deleted', 'medium', {
        userId,
        subaccountId,
        retellAccountId: retellAccount._id
      });

      res.json({
        success: true,
        message: 'Retell account deleted successfully'
      });

    } catch (error) {
      Logger.error('Failed to delete retell account', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
        subaccountId: req.params.subaccountId
      });
      next(error);
    }
  }
}

module.exports = RetellController; 