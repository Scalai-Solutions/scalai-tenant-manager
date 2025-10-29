const mongoose = require('mongoose');
const config = require('../config/config');
const Logger = require('../src/utils/logger');
const Subaccount = require('../src/models/Subaccount');
const UserSubaccount = require('../src/models/UserSubaccount');

/**
 * Script to reactivate a deactivated subaccount and all its users
 * Usage: node scripts/reactivateSubaccount.js <subaccountId>
 */
async function reactivateSubaccount(subaccountId) {
  try {
    // Connect to database
    console.log('Connecting to database...');
    await mongoose.connect(config.database.mongoUri, {
      dbName: config.database.dbName
    });
    console.log('✓ Connected to database\n');

    if (!subaccountId) {
      console.error('Error: Please provide a subaccount ID');
      console.log('Usage: node scripts/reactivateSubaccount.js <subaccountId>');
      process.exit(1);
    }

    // Validate subaccount ID
    if (!mongoose.Types.ObjectId.isValid(subaccountId)) {
      console.error('Error: Invalid subaccount ID format');
      process.exit(1);
    }

    // Find the subaccount
    const subaccount = await Subaccount.findById(subaccountId);
    
    if (!subaccount) {
      console.error(`Error: Subaccount with ID ${subaccountId} not found`);
      process.exit(1);
    }

    console.log(`Found subaccount: ${subaccount.name}`);
    console.log(`Current status: ${subaccount.isActive ? 'Active' : 'Inactive'}\n`);

    if (subaccount.isActive) {
      console.log('⚠️  Subaccount is already active');
    } else {
      // Reactivate the subaccount
      subaccount.isActive = true;
      await subaccount.save();
      console.log('✓ Subaccount reactivated');
    }

    // Find all deactivated UserSubaccount records for this subaccount
    const deactivatedUsers = await UserSubaccount.find({
      subaccountId,
      isActive: false
    });

    console.log(`\nFound ${deactivatedUsers.length} deactivated user(s) for this subaccount`);

    if (deactivatedUsers.length === 0) {
      console.log('✓ No deactivated users to reactivate');
    } else {
      // Reactivate all users
      let successCount = 0;
      let errorCount = 0;

      for (const userSubaccount of deactivatedUsers) {
        try {
          userSubaccount.isActive = true;
          await userSubaccount.save();
          
          console.log(`✓ Reactivated user: ${userSubaccount.userId} - Role: ${userSubaccount.role}`);
          successCount++;
        } catch (error) {
          console.error(`✗ Failed to reactivate user ${userSubaccount.userId}: ${error.message}`);
          errorCount++;
        }
      }

      console.log('\n=== Summary ===');
      console.log(`Subaccount: ${subaccount.name} (${subaccountId})`);
      console.log(`Status: ${subaccount.isActive ? 'Active' : 'Inactive'}`);
      console.log(`Total deactivated users found: ${deactivatedUsers.length}`);
      console.log(`Successfully reactivated: ${successCount}`);
      console.log(`Failed to reactivate: ${errorCount}`);
      console.log('✓ Reactivation complete');
    }

    Logger.info('Subaccount reactivation completed', {
      subaccountId,
      subaccountName: subaccount.name,
      usersReactivated: deactivatedUsers.length
    });

  } catch (error) {
    console.error('\nReactivation failed:', error.message);
    Logger.error('Subaccount reactivation failed', { 
      error: error.message, 
      stack: error.stack,
      subaccountId 
    });
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n✓ Database connection closed');
  }
}

// Get subaccount ID from command line arguments
const subaccountId = process.argv[2];
reactivateSubaccount(subaccountId);

