const redis = require('redis');
const config = require('../config/config');

/**
 * Script to clear all Redis caches
 */
async function clearAllCaches() {
  let client;
  
  try {
    console.log('Connecting to Redis...');
    console.log(`Redis URL: ${config.redis.url.replace(/:[^:@]+@/, ':****@')}`);
    
    client = redis.createClient({
      url: config.redis.url,
      socket: {
        tls: config.redis.url.startsWith('rediss://'),
        rejectUnauthorized: false // Accept self-signed certificates
      }
    });

    await client.connect();
    console.log('✓ Connected to Redis\n');

    // Clear all user_subaccounts caches
    console.log('Finding all cache keys...');
    const patterns = [
      'user_subaccounts:*',
      'subaccount:*',
      'permissions:*'
    ];

    let totalDeleted = 0;

    for (const pattern of patterns) {
      console.log(`\nScanning pattern: ${pattern}`);
      const keys = [];
      let cursor = '0';
      
      do {
        const reply = await client.scan(cursor, {
          MATCH: pattern,
          COUNT: 100
        });
        cursor = reply.cursor;
        keys.push(...reply.keys);
      } while (cursor !== '0');
      
      console.log(`Found ${keys.length} keys matching pattern: ${pattern}`);
      
      if (keys.length > 0) {
        // Show first few keys
        console.log('Sample keys:', keys.slice(0, 5));
        
        await client.del(keys);
        totalDeleted += keys.length;
        console.log(`✓ Deleted ${keys.length} keys`);
      }
    }

    console.log(`\n=== Summary ===`);
    console.log(`Total cache keys deleted: ${totalDeleted}`);
    console.log('✓ All caches cleared successfully');

  } catch (error) {
    console.error('\nCache clear failed:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  } finally {
    if (client) {
      await client.quit();
      console.log('\n✓ Redis connection closed');
    }
  }
}

clearAllCaches();

