# Scripts

Utility scripts for managing the Tenant Manager service.

## Available Scripts

### `clearCache.js`

A utility script for managing Redis cache keys.

#### Usage

```bash
# Show help
node scripts/clearCache.js --help

# Clear a specific key
node scripts/clearCache.js subaccount:123

# Clear keys matching a pattern
node scripts/clearCache.js "subaccount:*"
node scripts/clearCache.js "user_subaccount:*"
node scripts/clearCache.js "permissions:*"

# List all cache keys
node scripts/clearCache.js --list

# Clear all cache keys (use with caution!)
node scripts/clearCache.js --all
```

#### Examples

**Clear a specific subaccount cache:**
```bash
node scripts/clearCache.js subaccount:507f1f77bcf86cd799439011
```

**Clear all subaccount caches:**
```bash
node scripts/clearCache.js "subaccount:*"
```

**Clear all user-subaccount relationship caches:**
```bash
node scripts/clearCache.js "user_subaccount:*"
```

**Clear permissions for a specific user and subaccount:**
```bash
node scripts/clearCache.js permissions:user123:sub456
```

**List all cached keys:**
```bash
node scripts/clearCache.js --list
```

**Clear all cache (dangerous!):**
```bash
node scripts/clearCache.js --all
```

#### Cache Key Prefixes

The application uses the following cache key prefixes:

- `subaccount:` - Subaccount data cache
- `user_subaccount:` - User subaccount relationships
- `permissions:` - User permission cache
- `session:` - Session data
- `rate_limit:` - Rate limiting counters

#### Requirements

- The script uses the same Redis configuration from your `.env` file
- Requires `redis` npm package (already included in project dependencies)
- Make sure your Redis connection credentials are properly configured

#### Safety Features

- Confirms the number of keys that will be deleted when using patterns
- Shows which keys are being deleted
- Provides feedback on successful operations
- Handles errors gracefully

---

### `update-retell-api-key.js`

Updates the Retell API key for all RetellAccount documents with proper encryption.

#### Usage

```bash
node scripts/update-retell-api-key.js <new_api_key>
```

#### Examples

**Update all RetellAccount API keys:**
```bash
node scripts/update-retell-api-key.js key_f25360e791ad313eb4c6b4d17207
```

#### What It Does

1. **Connects to MongoDB** using credentials from `.env`
2. **Finds all RetellAccount documents** in the database
3. **Displays current accounts** with masked API keys
4. **Encrypts the new API key** using AES-256-CBC encryption
5. **Updates all accounts** with the new encrypted key
6. **Verifies each update** by decrypting and comparing
7. **Shows summary** of successful and failed updates

#### Features

- ✅ Proper AES-256-CBC encryption with salt
- ✅ Validates API key format (must start with "key_")
- ✅ Shows masked versions of API keys for security
- ✅ Verifies decryption works after each update
- ✅ Detailed logging of each step
- ✅ Summary report at the end
- ✅ Handles errors gracefully

#### Output Example

```
═══════════════════════════════════════════════════════
  Update Retell API Key for All RetellAccount Documents
═══════════════════════════════════════════════════════

🔄 Connecting to MongoDB...
✅ Connected to MongoDB

📋 Found 4 RetellAccount(s) to update

Current RetellAccounts:
  - ID: 68db8bc701453cfcfdc255b0
    SubaccountId: 68cf05f060d294db17c0685e
    Current API Key: key_3144...e2ae
    Active: true

🔑 New API Key: key_f253...7207

✅ Updated RetellAccount: 68db8bc701453cfcfdc255b0
...

📊 Update Summary:
  ✅ Successfully updated: 4
  ❌ Failed: 0
  📝 Total: 4

🎉 All RetellAccount API keys updated successfully!
```

#### Requirements

- Requires MongoDB connection (configured in `.env`)
- API key must start with "key_"
- Encryption key must be set in `.env` (ENCRYPTION_KEY)

#### Security

- API keys are encrypted using AES-256-CBC
- Encryption uses a salt: "retell-salt"
- Keys are never stored or logged in plain text
- Only masked versions (first 8 + last 4 chars) are shown

---

