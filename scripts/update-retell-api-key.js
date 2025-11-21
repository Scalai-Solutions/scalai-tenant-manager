/**
 * Script to update Retell API key for all RetellAccount documents
 * Usage: node scripts/update-retell-api-key.js <new_api_key>
 * Example: node scripts/update-retell-api-key.js key_f25360e791ad313eb4c6b4d17207
 */

require('dotenv').config();
const mongoose = require('mongoose');
const RetellAccount = require('../src/models/RetellAccount');
const config = require('../config/config');

async function updateRetellApiKey(newApiKey) {
  let connection;
  
  try {
    console.log('🔄 Connecting to MongoDB...');
    console.log(`MongoDB URI: ${config.database.mongoUri.replace(/\/\/.*@/, '//***:***@')}`);
    
    connection = await mongoose.connect(config.database.mongoUri, {
      dbName: config.database.dbName
    });
    
    console.log('✅ Connected to MongoDB');
    console.log(`Database: ${config.database.dbName}`);
    console.log('');

    // Find all RetellAccount documents
    const retellAccounts = await RetellAccount.find({})
      .select('+apiKey +encryptionIV +encryptionAuthTag');
    
    console.log(`📋 Found ${retellAccounts.length} RetellAccount(s) to update`);
    console.log('');

    if (retellAccounts.length === 0) {
      console.log('⚠️  No RetellAccount documents found. Nothing to update.');
      return;
    }

    // Display current accounts
    console.log('Current RetellAccounts:');
    for (const account of retellAccounts) {
      try {
        const currentKey = account.getDecryptedApiKey();
        const maskedCurrentKey = currentKey.substring(0, 8) + '...' + currentKey.substring(currentKey.length - 4);
        console.log(`  - ID: ${account._id}`);
        console.log(`    SubaccountId: ${account.subaccountId}`);
        console.log(`    Account Name: ${account.accountName || 'N/A'}`);
        console.log(`    Current API Key: ${maskedCurrentKey}`);
        console.log(`    Active: ${account.isActive}`);
      } catch (error) {
        console.log(`  - ID: ${account._id}`);
        console.log(`    SubaccountId: ${account.subaccountId}`);
        console.log(`    Current API Key: [Unable to decrypt - ${error.message}]`);
      }
      console.log('');
    }

    // Confirm update
    const maskedNewKey = newApiKey.substring(0, 8) + '...' + newApiKey.substring(newApiKey.length - 4);
    console.log(`🔑 New API Key: ${maskedNewKey}`);
    console.log('');
    console.log(`⚠️  This will update ALL ${retellAccounts.length} RetellAccount(s) with the new API key.`);
    console.log('');

    // Encrypt the new API key
    console.log('🔐 Encrypting new API key...');
    const encryptionResult = RetellAccount.encryptApiKey(newApiKey);
    console.log('✅ New API key encrypted successfully');
    console.log('');

    // Update all accounts
    let successCount = 0;
    let failCount = 0;

    for (const account of retellAccounts) {
      try {
        // Update with new encrypted key
        account.apiKey = encryptionResult.encrypted;
        account.encryptionIV = encryptionResult.iv;
        account.encryptionAuthTag = encryptionResult.authTag;
        
        // Save without triggering pre-save encryption (already encrypted)
        await account.save({ validateBeforeSave: true });
        
        // Verify decryption works
        const decrypted = account.getDecryptedApiKey();
        if (decrypted === newApiKey) {
          console.log(`✅ Updated RetellAccount: ${account._id} (Subaccount: ${account.subaccountId})`);
          successCount++;
        } else {
          console.log(`❌ Verification failed for RetellAccount: ${account._id}`);
          failCount++;
        }
      } catch (error) {
        console.log(`❌ Failed to update RetellAccount ${account._id}: ${error.message}`);
        failCount++;
      }
    }

    console.log('');
    console.log('📊 Update Summary:');
    console.log(`  ✅ Successfully updated: ${successCount}`);
    console.log(`  ❌ Failed: ${failCount}`);
    console.log(`  📝 Total: ${retellAccounts.length}`);
    console.log('');

    if (successCount === retellAccounts.length) {
      console.log('🎉 All RetellAccount API keys updated successfully!');
    } else if (successCount > 0) {
      console.log('⚠️  Some updates failed. Please check the errors above.');
    } else {
      console.log('❌ All updates failed. Please check the errors above.');
    }

  } catch (error) {
    console.error('❌ Error updating Retell API keys:', error.message);
    console.error(error.stack);
    throw error;
  } finally {
    if (connection) {
      await mongoose.disconnect();
      console.log('');
      console.log('✅ Disconnected from MongoDB');
    }
  }
}

// Main execution
const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('❌ Error: No API key provided');
  console.error('');
  console.error('Usage: node scripts/update-retell-api-key.js <new_api_key>');
  console.error('Example: node scripts/update-retell-api-key.js key_f25360e791ad313eb4c6b4d17207');
  process.exit(1);
}

const [newApiKey] = args;

// Validate API key format
if (!newApiKey.startsWith('key_')) {
  console.error('❌ Error: Invalid API key format. Retell API keys should start with "key_"');
  process.exit(1);
}

console.log('');
console.log('═══════════════════════════════════════════════════════');
console.log('  Update Retell API Key for All RetellAccount Documents');
console.log('═══════════════════════════════════════════════════════');
console.log('');

updateRetellApiKey(newApiKey)
  .then(() => {
    console.log('');
    console.log('✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.log('');
    console.error('❌ Script failed:', error.message);
    process.exit(1);
  });

