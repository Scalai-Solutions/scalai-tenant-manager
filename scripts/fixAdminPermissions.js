const mongoose = require('mongoose');
const config = require('../config/config');
const Logger = require('../src/utils/logger');
const UserSubaccount = require('../src/models/UserSubaccount');

/**
 * Script to fix admin permissions for existing admin role users
 * This updates all UserSubaccount records where role='admin' but permissions.admin=false
 */
async function fixAdminPermissions() {
  try {
    // Connect to database
    console.log('Connecting to database...');
    await mongoose.connect(config.database.mongoUri, {
      dbName: config.database.dbName
    });
    console.log('✓ Connected to database');

    // Find all admin users with incorrect permissions
    const adminUsers = await UserSubaccount.find({
      role: 'admin',
      'permissions.admin': false
    });

    console.log(`\nFound ${adminUsers.length} admin users with incorrect permissions`);

    if (adminUsers.length === 0) {
      console.log('✓ No admin users need permission updates');
      process.exit(0);
    }

    // Update each admin user's permissions
    let successCount = 0;
    let errorCount = 0;

    for (const userSubaccount of adminUsers) {
      try {
        userSubaccount.permissions.admin = true;
        await userSubaccount.save();
        
        console.log(`✓ Updated permissions for user ${userSubaccount.userId} in subaccount ${userSubaccount.subaccountId}`);
        successCount++;
      } catch (error) {
        console.error(`✗ Failed to update user ${userSubaccount.userId}: ${error.message}`);
        errorCount++;
      }
    }

    console.log('\n=== Summary ===');
    console.log(`Total admin users found: ${adminUsers.length}`);
    console.log(`Successfully updated: ${successCount}`);
    console.log(`Failed to update: ${errorCount}`);
    console.log('✓ Migration complete');

    Logger.info('Admin permissions migration completed', {
      total: adminUsers.length,
      success: successCount,
      errors: errorCount
    });

  } catch (error) {
    console.error('Migration failed:', error);
    Logger.error('Admin permissions migration failed', { error: error.message, stack: error.stack });
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n✓ Database connection closed');
  }
}

// Run the migration
fixAdminPermissions();

