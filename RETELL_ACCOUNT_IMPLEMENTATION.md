# Retell Account Implementation

This document describes the implementation of the Retell account management system for subaccounts.

## Overview

Each subaccount can now have a connected Retell account with an encrypted API key. The implementation follows the same encryption approach used for MongoDB connection strings.

## Architecture

### Database Schema

#### RetellAccount Collection
- **apiKey**: Encrypted Retell API key (hidden by default)
- **encryptionIV**: Initialization vector for encryption
- **encryptionAuthTag**: Authentication tag for encryption
- **accountName**: Optional display name for the account
- **isActive**: Status flag
- **subaccountId**: Reference to the parent subaccount (unique index)
- **verificationStatus**: Status of API key verification ('pending', 'verified', 'failed')
- **lastVerified**: Timestamp of last verification
- **createdBy**: Reference to the user who created the account
- **timestamps**: createdAt and updatedAt

#### Subaccount Model Update
- Added `retellAccountId` field to reference the associated RetellAccount

### Encryption

The Retell API key is encrypted using the same approach as MongoDB URLs:
- **Algorithm**: AES-256-CBC
- **Salt**: 'retell-salt'
- **Key Source**: `config.encryption.key` (from environment variables)

The encryption happens automatically in the pre-save middleware, similar to the Subaccount model.

## API Endpoints

All retell account routes are nested under subaccount routes and require authentication.

### Base Path
`/api/subaccounts/:subaccountId/retell`

### Endpoints

#### 1. GET - Get Retell Account
```
GET /api/subaccounts/:subaccountId/retell
```

**Authentication**: User token or Service token  
**Authorization**: Read access to subaccount  
**Response**: Retell account details (without API key for regular users)

**Response Example**:
```json
{
  "success": true,
  "message": "Retell account retrieved successfully",
  "data": {
    "id": "507f1f77bcf86cd799439011",
    "accountName": "Production Retell",
    "isActive": true,
    "subaccountId": "507f191e810c19729de860ea",
    "verificationStatus": "verified",
    "lastVerified": "2025-09-30T10:00:00.000Z",
    "createdAt": "2025-09-01T10:00:00.000Z",
    "updatedAt": "2025-09-30T10:00:00.000Z"
  }
}
```

#### 2. PUT - Create or Update Retell Account (Upsert)
```
PUT /api/subaccounts/:subaccountId/retell
```

**Authentication**: User token  
**Authorization**: Admin access to subaccount  
**Request Body**:
```json
{
  "apiKey": "your-retell-api-key",
  "accountName": "Production Retell"
}
```

**Response**: 201 (Created) or 200 (Updated)

#### 3. PATCH - Partially Update Retell Account
```
PATCH /api/subaccounts/:subaccountId/retell
```

**Authentication**: User token  
**Authorization**: Admin access to subaccount  
**Request Body** (all fields optional):
```json
{
  "apiKey": "new-retell-api-key",
  "accountName": "Updated Name",
  "isActive": true
}
```

**Response**: 200 (OK)

#### 4. DELETE - Delete Retell Account
```
DELETE /api/subaccounts/:subaccountId/retell
```

**Authentication**: User token  
**Authorization**: Admin access to subaccount  
**Response**: 200 (OK)

## Security Features

1. **Encryption at Rest**: API keys are encrypted before storage using AES-256-CBC
2. **Selective Exposure**: API keys are only returned for:
   - Service-to-service requests (with service token)
   - Super admin users
   - Requests with specific service headers
3. **Permission Checks**: All write operations require admin permissions on the subaccount
4. **Rate Limiting**: Burst protection applied to delete operations
5. **Audit Logging**: All operations are logged with user and subaccount context
6. **Cache Invalidation**: Redis caches are invalidated on updates

## Integration with Existing System

### Subaccount Model
The `Subaccount` model now includes:
- A reference to `RetellAccount` via `retellAccountId`
- Population of retell account info when fetching subaccount details

### Subaccount GET Endpoint
When fetching a subaccount, the response now includes retell account information:
```json
{
  "retellAccount": {
    "id": "507f1f77bcf86cd799439011",
    "accountName": "Production Retell",
    "isActive": true,
    "verificationStatus": "verified",
    "lastVerified": "2025-09-30T10:00:00.000Z"
  }
}
```

## Files Created/Modified

### New Files
1. `src/models/RetellAccount.js` - RetellAccount model with encryption
2. `src/validators/retellValidator.js` - Validation schemas for retell operations
3. `src/controllers/retellController.js` - Controller for retell account operations

### Modified Files
1. `src/models/Subaccount.js` - Added retellAccountId reference
2. `src/routes/subaccountRoutes.js` - Added retell account routes
3. `src/controllers/subaccountController.js` - Updated to populate retell account info

## Usage Examples

### Creating a Retell Account
```bash
curl -X PUT https://api.example.com/api/subaccounts/507f191e810c19729de860ea/retell \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "apiKey": "sk_retell_123456789abcdef",
    "accountName": "Production Retell Account"
  }'
```

### Getting Retell Account
```bash
curl -X GET https://api.example.com/api/subaccounts/507f191e810c19729de860ea/retell \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Updating Retell Account
```bash
curl -X PATCH https://api.example.com/api/subaccounts/507f191e810c19729de860ea/retell \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "accountName": "Updated Account Name"
  }'
```

### Deleting Retell Account
```bash
curl -X DELETE https://api.example.com/api/subaccounts/507f191e810c19729de860ea/retell \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## Error Codes

- `RETELL_ACCOUNT_NOT_FOUND` - Retell account not found for the subaccount
- `INSUFFICIENT_PERMISSIONS` - User lacks required permissions
- `SUBACCOUNT_NOT_FOUND` - Parent subaccount not found
- `DUPLICATE_RETELL_ACCOUNT` - Retell account already exists (should not occur with upsert)
- `VALIDATION_ERROR` - Request validation failed

## Future Enhancements

1. **API Key Verification**: Implement actual verification of Retell API keys
2. **Automatic Refresh**: Support for token refresh if Retell uses expiring tokens
3. **Usage Tracking**: Track API usage and quota
4. **Webhook Support**: Support for Retell webhooks
5. **Multi-Environment**: Support for separate dev/staging/production Retell accounts

## Testing

To test the implementation:

1. Create a subaccount first
2. Add a retell account to the subaccount
3. Retrieve the subaccount to see retell info populated
4. Update the retell account
5. Delete the retell account
6. Verify the reference is removed from the subaccount

## Notes

- One retell account per subaccount (enforced by unique index)
- API keys are never logged or returned in regular queries
- Encryption uses the same key as MongoDB URL encryption
- All operations are cached and cache is invalidated on updates 