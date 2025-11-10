#!/usr/bin/env node

/**
 * Clear Subaccount Users Cache Script
 * 
 * This script clears the cache for the GET /api/subaccounts/:subaccountId/users endpoint.
 * 
 * Usage:
 *   node scripts/clearSubaccountUsersCache.js <subaccountId>    - Clear cache for specific subaccount
 *   node scripts/clearSubaccountUsersCache.js --all             - Clear all subaccount users caches
 *   node scripts/clearSubaccountUsersCache.js --help            - Show help
 * 
 * Examples:
 *   node scripts/clearSubaccountUsersCache.js 691195f12f684722a50477bc
 *   node scripts/clearSubaccountUsersCache.js --all
 */

require('dotenv').config();
const Database = require('../src/utils/database');
const redisManager = require('../src/services/redisManager');
const Logger = require('../src/utils/logger');

class SubaccountUsersCacheClearer {
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

  async clearAllSubaccountUsersCache() {
    try {
      console.log('Clearing all subaccount users caches...\n');
      
      // Use SCAN to find all keys matching the pattern
      const pattern = 'subaccount_users:*';
      const keys = [];
      let cursor = '0';
      
      do {
        const reply = await this.redisService.client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        
        if (!reply || !Array.isArray(reply) || reply.length < 2) {
          console.warn('⚠️  Unexpected SCAN reply format');
          break;
        }
        
        cursor = reply[0];
        const foundKeys = reply[1];
        
        if (Array.isArray(foundKeys)) {
          keys.push(...foundKeys);
          if (foundKeys.length > 0) {
            console.log(`  Found ${foundKeys.length} key(s) in this batch...`);
          }
        } else {
          break;
        }
      } while (cursor !== '0' && cursor !== 0);
      
      if (keys.length === 0) {
        console.log('✓ No cache keys found to clear');
        return 0;
      }

      console.log(`\nFound ${keys.length} cache key(s) to delete...`);
      
      // Delete in batches to avoid overwhelming Redis
      const batchSize = 100;
      let deletedCount = 0;
      
      for (let i = 0; i < keys.length; i += batchSize) {
        const batch = keys.slice(i, i + batchSize);
        await this.redisService.client.del(...batch);
        deletedCount += batch.length;
        console.log(`  ✓ Deleted batch ${Math.floor(i / batchSize) + 1} (${batch.length} keys)`);
      }

      console.log(`\n✓ Successfully cleared ${deletedCount} cache key(s)`);
      return deletedCount;
    } catch (error) {
      console.error('✗ Error clearing all caches:', error.message);
      throw error;
    }
  }

  async clearSubaccountUsersCache(subaccountId) {
    try {
      console.log(`Clearing cache for subaccount: ${subaccountId}\n`);
      
      const deletedCount = await this.redisService.invalidateSubaccountUsers(subaccountId);
      
      if (deletedCount === null) {
        console.log('⚠️  Could not clear cache (Redis may not be connected)');
        return false;
      }

      if (deletedCount === 0) {
        console.log(`✓ No cache keys found for subaccount: ${subaccountId}`);
      } else {
        console.log(`✓ Successfully cleared ${deletedCount} cache key(s) for subaccount: ${subaccountId}`);
      }

      return true;
    } catch (error) {
      console.error(`✗ Error clearing cache for subaccount ${subaccountId}:`, error.message);
      throw error;
    }
  }

  async showHelp() {
    console.log(`
Clear Subaccount Users Cache Script
====================================

This script clears the Redis cache for the GET /api/subaccounts/:subaccountId/users endpoint.

Usage:
  node scripts/clearSubaccountUsersCache.js <subaccountId>    - Clear cache for specific subaccount
  node scripts/clearSubaccountUsersCache.js --all             - Clear all subaccount users caches
  node scripts/clearSubaccountUsersCache.js --help             - Show this help message

Examples:
  # Clear cache for a specific subaccount
  node scripts/clearSubaccountUsersCache.js 691195f12f684722a50477bc
  
  # Clear all subaccount users caches
  node scripts/clearSubaccountUsersCache.js --all

Cache Keys Cleared:
  - subaccount_users:<subaccountId>:*    All cached user lists for the subaccount

Note:
  This script uses the same Redis invalidation methods as the application,
  ensuring consistency with the cache clearing logic.
  
  Use this script when:
  - User roles/permissions are updated directly in the database
  - Cached user data appears stale
  - You need to force a refresh of subaccount user lists
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
        await this.clearAllSubaccountUsersCache();
      } else {
        // Assume it's a subaccountId
        const subaccountId = command;
        
        // Basic validation - MongoDB ObjectId format
        if (!/^[0-9a-fA-F]{24}$/.test(subaccountId)) {
          console.error(`✗ Invalid subaccount ID format: ${subaccountId}`);
          console.error('  Subaccount ID must be a valid MongoDB ObjectId (24 hex characters)');
          process.exit(1);
        }

        await this.clearSubaccountUsersCache(subaccountId);
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
const clearer = new SubaccountUsersCacheClearer();
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

