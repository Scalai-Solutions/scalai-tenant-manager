#!/usr/bin/env node

/**
 * Clear Get Subaccounts API Cache Script
 * 
 * This script clears the cache for the GET /api/subaccounts endpoint.
 * 
 * Usage:
 *   node scripts/clearSubaccountsCache.js                    - Clear all user subaccount caches
 *   node scripts/clearSubaccountsCache.js <userId>          - Clear cache for specific user
 *   node scripts/clearSubaccountsCache.js --all             - Clear all user subaccount caches (same as no args)
 *   node scripts/clearSubaccountsCache.js --help            - Show help
 * 
 * Examples:
 *   node scripts/clearSubaccountsCache.js
 *   node scripts/clearSubaccountsCache.js 68cd5f76605c030f71d32e01
 *   node scripts/clearSubaccountsCache.js --all
 */

require('dotenv').config();
const Database = require('../src/utils/database');
const redisManager = require('../src/services/redisManager');
const Logger = require('../src/utils/logger');

class SubaccountsCacheClearer {
  constructor() {
    this.redisService = null;
  }

  async initialize() {
    try {
      console.log('Initializing database connection...');
      await Database.connect();
      console.log('✓ Database connected\n');

      console.log('Initializing Redis connection...');
      this.redisService = redisManager.getRedisService();
      
      if (!this.redisService || !this.redisService.isConnected) {
        console.log('⚠️  Redis not connected. Attempting to connect...');
        await redisManager.initialize();
        this.redisService = redisManager.getRedisService();
      }

      if (!this.redisService || !this.redisService.isConnected) {
        throw new Error('Redis is not available. Please ensure Redis is running and configured.');
      }

      console.log('✓ Redis connected\n');
    } catch (error) {
      console.error('✗ Initialization failed:', error.message);
      throw error;
    }
  }

  async clearAllUserSubaccountsCache() {
    try {
      console.log('Clearing all user subaccount caches...\n');
      
      const deletedCount = await this.redisService.invalidateAllUserSubaccounts();
      
      if (deletedCount === null) {
        console.log('⚠️  Could not clear cache (Redis may not be connected)');
        return false;
      }

      if (deletedCount === 0) {
        console.log('✓ No cache keys found to clear');
      } else {
        console.log(`✓ Successfully cleared ${deletedCount} cache key(s)`);
      }

      return true;
    } catch (error) {
      console.error('✗ Error clearing all caches:', error.message);
      throw error;
    }
  }

  async clearUserSubaccountsCache(userId) {
    try {
      console.log(`Clearing cache for user: ${userId}\n`);
      
      const deletedCount = await this.redisService.invalidateUserSubaccounts(userId);
      
      if (deletedCount === null) {
        console.log('⚠️  Could not clear cache (Redis may not be connected)');
        return false;
      }

      if (deletedCount === 0) {
        console.log(`✓ No cache keys found for user: ${userId}`);
      } else {
        console.log(`✓ Successfully cleared ${deletedCount} cache key(s) for user: ${userId}`);
      }

      return true;
    } catch (error) {
      console.error(`✗ Error clearing cache for user ${userId}:`, error.message);
      throw error;
    }
  }

  async showHelp() {
    console.log(`
Clear Get Subaccounts API Cache Script
======================================

This script clears the Redis cache for the GET /api/subaccounts endpoint.

Usage:
  node scripts/clearSubaccountsCache.js                    - Clear all user subaccount caches
  node scripts/clearSubaccountsCache.js <userId>            - Clear cache for specific user
  node scripts/clearSubaccountsCache.js --all              - Clear all user subaccount caches
  node scripts/clearSubaccountsCache.js --help              - Show this help message

Examples:
  # Clear all caches
  node scripts/clearSubaccountsCache.js
  
  # Clear cache for a specific user
  node scripts/clearSubaccountsCache.js 68cd5f76605c030f71d32e01
  
  # Clear all caches (explicit)
  node scripts/clearSubaccountsCache.js --all

Cache Keys Cleared:
  - user_subaccounts:*          All user subaccount relationship caches
  - user_subaccounts:<userId>:* Specific user's subaccount cache

Note:
  This script uses the same Redis invalidation methods as the application,
  ensuring consistency with the cache clearing logic.
    `);
  }

  async run(args) {
    try {
      await this.initialize();

      if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
        await this.showHelp();
        return;
      }

      const command = args[0];

      if (command === '--all' || command === '-a') {
        await this.clearAllUserSubaccountsCache();
      } else {
        // Assume it's a userId
        const userId = command;
        
        // Basic validation - MongoDB ObjectId format
        if (!/^[0-9a-fA-F]{24}$/.test(userId)) {
          console.error(`✗ Invalid user ID format: ${userId}`);
          console.error('  User ID must be a valid MongoDB ObjectId (24 hex characters)');
          process.exit(1);
        }

        await this.clearUserSubaccountsCache(userId);
      }

    } catch (error) {
      console.error('\n✗ Error:', error.message);
      if (error.stack) {
        console.error('\nStack trace:', error.stack);
      }
      process.exit(1);
    } finally {
      // Close database connection
      try {
        await Database.disconnect();
        console.log('\n✓ Database disconnected');
      } catch (error) {
        console.error('Error disconnecting database:', error.message);
      }
    }
  }
}

// Run the script
const clearer = new SubaccountsCacheClearer();
const args = process.argv.slice(2);

clearer.run(args)
  .then(() => {
    console.log('\n✓ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n✗ Fatal error:', error);
    process.exit(1);
  });

