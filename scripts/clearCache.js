#!/usr/bin/env node

/**
 * Redis Cache Clearing Script
 * 
 * Usage:
 *   node scripts/clearCache.js <key>           - Clear a specific key
 *   node scripts/clearCache.js <pattern>       - Clear keys matching pattern (use *)
 *   node scripts/clearCache.js --all           - Clear all cache keys
 *   node scripts/clearCache.js --list          - List all cache keys
 * 
 * Examples:
 *   node scripts/clearCache.js subaccount:123
 *   node scripts/clearCache.js "subaccount:*"
 *   node scripts/clearCache.js "user_subaccount:*"
 *   node scripts/clearCache.js permissions:user123:sub456
 *   node scripts/clearCache.js --all
 */

require('dotenv').config();
const redis = require('redis');
const config = require('../config/config');

class CacheClearer {
  constructor() {
    this.client = null;
  }

  async connect() {
    try {
      console.log('Connecting to Redis...');
      
      if (config.redis.url) {
        this.client = redis.createClient({
          url: config.redis.url,
          socket: {
            tls: true,
            rejectUnauthorized: false
          }
        });
      } else {
        this.client = redis.createClient({
          host: config.redis.host,
          port: config.redis.port,
          password: config.redis.password,
          db: config.redis.db,
          socket: {
            tls: true,
            rejectUnauthorized: false
          }
        });
      }

      this.client.on('error', (err) => {
        console.error('Redis Client Error:', err);
      });

      await this.client.connect();
      await this.client.ping();
      console.log('✓ Connected to Redis successfully\n');
    } catch (error) {
      console.error('Failed to connect to Redis:', error.message);
      throw error;
    }
  }

  async disconnect() {
    if (this.client) {
      await this.client.quit();
      console.log('\n✓ Disconnected from Redis');
    }
  }

  async listKeys(pattern = '*') {
    try {
      const keys = await this.client.keys(pattern);
      return keys;
    } catch (error) {
      console.error('Error listing keys:', error.message);
      throw error;
    }
  }

  async clearKey(key) {
    try {
      const exists = await this.client.exists(key);
      if (exists) {
        await this.client.del(key);
        return true;
      }
      return false;
    } catch (error) {
      console.error(`Error clearing key '${key}':`, error.message);
      throw error;
    }
  }

  async clearPattern(pattern) {
    try {
      const keys = await this.listKeys(pattern);
      
      if (keys.length === 0) {
        console.log(`No keys found matching pattern: ${pattern}`);
        return 0;
      }

      console.log(`Found ${keys.length} key(s) matching pattern: ${pattern}`);
      
      // Delete all matching keys
      let deletedCount = 0;
      for (const key of keys) {
        await this.client.del(key);
        deletedCount++;
        console.log(`  ✓ Deleted: ${key}`);
      }

      return deletedCount;
    } catch (error) {
      console.error(`Error clearing pattern '${pattern}':`, error.message);
      throw error;
    }
  }

  async showHelp() {
    console.log(`
Redis Cache Clearing Script
============================

Usage:
  node scripts/clearCache.js <key>           - Clear a specific key
  node scripts/clearCache.js <pattern>       - Clear keys matching pattern (use *)
  node scripts/clearCache.js --all           - Clear all cache keys
  node scripts/clearCache.js --list          - List all cache keys
  node scripts/clearCache.js --help          - Show this help message

Examples:
  node scripts/clearCache.js subaccount:123
  node scripts/clearCache.js "subaccount:*"
  node scripts/clearCache.js "user_subaccount:*"
  node scripts/clearCache.js permissions:user123:sub456
  node scripts/clearCache.js --all
  node scripts/clearCache.js --list

Available Cache Prefixes:
  - subaccount:         Subaccount data cache
  - user_subaccount:    User subaccount relationships
  - permissions:        User permission cache
  - session:            Session data
  - rate_limit:         Rate limiting counters
    `);
  }

  async run(args) {
    try {
      await this.connect();

      if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
        await this.showHelp();
        return;
      }

      const command = args[0];

      switch (command) {
        case '--list':
        case '-l': {
          console.log('Listing all cache keys...\n');
          const keys = await this.listKeys('*');
          
          if (keys.length === 0) {
            console.log('No cache keys found.');
          } else {
            console.log(`Found ${keys.length} key(s):\n`);
            
            // Group keys by prefix
            const grouped = {};
            keys.forEach(key => {
              const prefix = key.split(':')[0];
              if (!grouped[prefix]) {
                grouped[prefix] = [];
              }
              grouped[prefix].push(key);
            });

            // Display grouped keys
            Object.keys(grouped).sort().forEach(prefix => {
              console.log(`\n${prefix}: (${grouped[prefix].length} keys)`);
              grouped[prefix].forEach(key => {
                console.log(`  - ${key}`);
              });
            });
          }
          break;
        }

        case '--all':
        case '-a': {
          console.log('⚠️  WARNING: This will clear ALL cache keys!');
          console.log('Clearing all cache keys...\n');
          
          const deletedCount = await this.clearPattern('*');
          
          if (deletedCount > 0) {
            console.log(`\n✓ Successfully cleared ${deletedCount} key(s)`);
          }
          break;
        }

        default: {
          const keyOrPattern = command;
          
          // Check if it's a pattern (contains *)
          if (keyOrPattern.includes('*')) {
            console.log(`Clearing keys matching pattern: ${keyOrPattern}\n`);
            const deletedCount = await this.clearPattern(keyOrPattern);
            
            if (deletedCount > 0) {
              console.log(`\n✓ Successfully cleared ${deletedCount} key(s)`);
            }
          } else {
            // Single key
            console.log(`Clearing key: ${keyOrPattern}\n`);
            const deleted = await this.clearKey(keyOrPattern);
            
            if (deleted) {
              console.log(`✓ Successfully cleared key: ${keyOrPattern}`);
            } else {
              console.log(`⚠️  Key not found: ${keyOrPattern}`);
            }
          }
          break;
        }
      }

    } catch (error) {
      console.error('\n✗ Error:', error.message);
      process.exit(1);
    } finally {
      await this.disconnect();
    }
  }
}

// Run the script
const clearer = new CacheClearer();
const args = process.argv.slice(2);

clearer.run(args)
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });

