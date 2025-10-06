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

