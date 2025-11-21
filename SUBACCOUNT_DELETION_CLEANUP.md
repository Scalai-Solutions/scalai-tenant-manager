# Subaccount Deletion - Automatic Twilio Trunk & Phone Number Cleanup

## Overview

When a subaccount is deleted, the system now automatically performs comprehensive cleanup of Twilio resources to prevent orphaned trunks and phone numbers. This ensures that Twilio resources are properly released and costs are minimized.

**Key Change:** The trunk is now deleted FIRST, and phone numbers are recorded before being released. This provides better tracking and prevents issues with trunk-phone number dependencies.

---

## Cleanup Flow

When you delete a subaccount, the following cleanup happens **automatically** in this order:

### 1. **MongoDB Database Deletion** ✅
- Drops the entire MongoDB database associated with the subaccount
- All collections and data are permanently removed

### 2. **Retell Resources Cleanup** ✅
#### a. Agents Deletion
- All Retell AI agents are deleted from Retell
- Agents configuration is removed

#### b. **Twilio Trunk Deletion (FIRST!)** 🎯
**NEW ORDER: Trunk is deleted BEFORE phone numbers!**

The trunk deletion process now:
1. **Records all phone numbers** attached to the trunk
2. **Deletes the trunk** from Twilio (even if it has phone numbers)
3. **Returns the list** of phone numbers that need to be released

**Why this order?**
- ✅ Twilio allows trunk deletion even with attached numbers
- ✅ Provides better tracking of which numbers were attached
- ✅ Prevents timing issues and race conditions
- ✅ Simplifies the cleanup logic

#### c. **Phone Number Release from Twilio** 
After trunk deletion, the recorded phone numbers are released:
- **Removes emergency addresses** from phone numbers
- **Deletes phone numbers** from Twilio account (releases them)
- All phone numbers that were attached to the trunk are released

#### d. **Phone Numbers Cleanup (Retell Only)**
After Twilio release, clean up Retell:
- **Deletes from Retell** (removes phone number from Retell's system)
- **Note:** MongoDB cleanup is not needed as the database was already dropped in Step 1

#### e. Knowledge Bases Deletion
- All Retell knowledge bases are deleted

#### f. Call Logs Deletion
- Call history is cleaned up (up to 1000 most recent calls)

### 3. **Database Records Cleanup** ✅
- User-subaccount relationships removed
- Subaccount record deleted
- User subaccount counts updated

### 4. **Cache Invalidation** ✅
- All Redis caches for the subaccount are cleared
- User caches updated

---

## Implementation Details

### Endpoint 1: Delete Twilio Trunk

**Endpoint:** `DELETE /api/connectors/:subaccountId/twilio-trunk`
**Server:** Database Server (port 3002)
**Authentication:** Service-to-service (requires `X-Service-Token`)

**Purpose:** Deletes the Twilio SIP trunk and returns phone numbers that need to be released

**Request:**
```bash
DELETE http://localhost:3002/api/connectors/{subaccountId}/twilio-trunk
Headers:
  X-Service-Token: {SERVICE_TOKEN}
  X-Service-Name: tenant-manager
```

**Response (Success - With Phone Numbers):**
```json
{
  "success": true,
  "message": "Twilio trunk deleted successfully",
  "data": {
    "success": true,
    "trunkSid": "TK...",
    "trunkDeleted": true,
    "metadataCleared": true,
    "phoneNumbersToRelease": [
      {
        "phoneNumber": "+447111111111",
        "sid": "PN..."
      },
      {
        "phoneNumber": "+447222222222",
        "sid": "PN..."
      }
    ]
  }
}
```

**Response (Success - No Phone Numbers):**
```json
{
  "success": true,
  "message": "Twilio trunk deleted successfully",
  "data": {
    "success": true,
    "trunkSid": "TK...",
    "trunkDeleted": true,
    "metadataCleared": true,
    "phoneNumbersToRelease": []
  }
}
```

**Response (Skipped - No Trunk):**
```json
{
  "success": true,
  "message": "Trunk deletion skipped: No trunk SID found in connector metadata",
  "data": {
    "success": false,
    "skipped": true,
    "reason": "No trunk SID found in connector metadata",
    "trunkDeleted": false,
    "phoneNumbersToRelease": []
  }
}
```

---

### Endpoint 2: Release Phone Numbers from Twilio

**Endpoint:** `POST /api/connectors/:subaccountId/twilio/release-phone-numbers`
**Server:** Database Server (port 3002)
**Authentication:** Service-to-service (requires `X-Service-Token`)

**Purpose:** Releases phone numbers from Twilio account (after trunk deletion)

**Request:**
```bash
POST http://localhost:3002/api/connectors/{subaccountId}/twilio/release-phone-numbers
Headers:
  X-Service-Token: {SERVICE_TOKEN}
  X-Service-Name: tenant-manager
Content-Type: application/json

Body:
{
  "phoneNumbersToRelease": [
    {
      "phoneNumber": "+447111111111",
      "sid": "PN..."
    },
    {
      "phoneNumber": "+447222222222",
      "sid": "PN..."
    }
  ]
}
```

**Response (Success):**
```json
{
  "success": true,
  "message": "Phone numbers released from Twilio",
  "data": {
    "success": true,
    "phoneNumbersReleased": ["+447111111111", "+447222222222"],
    "phoneNumbersFailed": []
  }
}
```

**Response (Partial Success):**
```json
{
  "success": true,
  "message": "Phone numbers released from Twilio",
  "data": {
    "success": true,
    "phoneNumbersReleased": ["+447111111111"],
    "phoneNumbersFailed": [
      {
        "phoneNumber": "+447222222222",
        "error": "Phone number not found"
      }
    ]
  }
}
```

---

## Safety Features

### 1. **Phone Number Recording**
Before deleting the trunk, the system records all phone numbers attached to it:
```javascript
// Record all phone numbers attached to the trunk
const phoneNumbers = await client.trunking.v1
  .trunks(trunkSid)
  .phoneNumbers
  .list();

// Store them for later release
phoneNumbersToRelease = phoneNumbers.map(pn => ({
  phoneNumber: pn.phoneNumber,
  sid: pn.sid
}));
```

### 2. **Trunk Deletion (Even With Numbers)**
The trunk is deleted regardless of whether it has phone numbers:
```javascript
// Delete trunk from Twilio (Twilio allows this even with numbers)
await client.trunking.v1.trunks(trunkSid).remove();
```

**Why this works:**
- Twilio allows trunk deletion even with attached phone numbers
- Phone numbers remain in Twilio account but are no longer associated with the trunk
- They can then be released independently

### 3. **Error Handling**
- If trunk deletion fails, **subaccount deletion continues** (non-blocking)
- All errors are logged with full context for debugging
- If trunk is already deleted in Twilio, metadata is still cleaned up
- If phone number release fails, we continue with other numbers

### 4. **Graceful Degradation**
If any step fails:
- The deletion process **continues** to the next step
- Detailed logs are generated for troubleshooting
- User is still shown success if core deletion completed

---

## Deletion Order (Critical!)

The order of operations is **critical** for proper cleanup:

```
1. Drop MongoDB Database
   ↓
2. Delete Retell Agents
   ↓
3. 🎯 DELETE TWILIO TRUNK (FIRST!)
   ├─ Records phone numbers attached to trunk
   ├─ Deletes trunk from Twilio
   └─ Returns list of phone numbers to release
   ↓
4. Release Phone Numbers from Twilio
   ├─ Removes emergency addresses
   ├─ Deletes phone numbers from Twilio account
   └─ Releases numbers back to Twilio pool
   ↓
5. Delete Phone Numbers (Retell only)
   └─ Deletes from Retell
   (MongoDB cleanup not needed - database already dropped)
   ↓
6. Delete Knowledge Bases
   ↓
7. Delete Call Logs
   ↓
8. Delete Database Records
   ↓
9. Clear Caches
```

**Why this order?**
- ✅ **Trunk deleted FIRST** - Records phone numbers for proper tracking
- ✅ **Phone numbers released AFTER trunk** - Prevents dependency issues
- ✅ **Retell & MongoDB cleanup last** - All external systems cleaned up first
- ✅ **Database operations happen after** all external API calls complete
- ✅ **Caches are cleared last** to prevent stale data

**Key Advantages:**
- ✅ No timing issues or race conditions
- ✅ Better error handling and recovery
- ✅ Complete audit trail of what was deleted
- ✅ Simplified logic with fewer edge cases

---

## Testing

### Manual Test

1. **Create a test subaccount**
```bash
POST http://localhost:3003/api/subaccounts
{
  "name": "Test Subaccount",
  "description": "For deletion testing",
  "databaseName": "test_subaccount_db"
}
```

2. **Setup Twilio and buy phone numbers**
```bash
# Setup Twilio (creates trunk)
POST http://localhost:3002/api/connectors/{subaccountId}/twilio/setup/{emergencyAddressId}

# Purchase phone numbers (attaches to trunk)
POST http://localhost:3002/api/connectors/{subaccountId}/twilio/phoneNumbers/purchase
{
  "phoneNumber": "+447111111111"
}
```

3. **Delete the subaccount**
```bash
DELETE http://localhost:3003/api/subaccounts/{subaccountId}
```

4. **Verify cleanup**
```bash
# Check Twilio Console
# - Trunk should be deleted
# - Phone numbers should be released

# Check logs
# - Look for "Twilio trunk deleted successfully"
# - Verify no errors in trunk deletion
```

---

## Logs

### Successful Trunk Deletion with Phone Numbers
```
[INFO] Deleting Twilio trunk for subaccount {
  subaccountId: '69199436c98895ff97a17e95'
}

[INFO] Found trunk SID to delete {
  subaccountId: '69199436c98895ff97a17e95',
  trunkSid: 'TK1234567890abcdef1234567890abcd'
}

[INFO] Recorded phone numbers attached to trunk {
  subaccountId: '69199436c98895ff97a17e95',
  trunkSid: 'TK1234567890abcdef1234567890abcd',
  phoneNumberCount: 2,
  phoneNumbers: ['+447111111111', '+447222222222']
}

[INFO] Trunk deleted successfully from Twilio {
  subaccountId: '69199436c98895ff97a17e95',
  trunkSid: 'TK1234567890abcdef1234567890abcd',
  phoneNumbersRecorded: 2
}

[INFO] Twilio trunk deleted successfully {
  subaccountId: '69199436c98895ff97a17e95',
  trunkSid: 'TK1234567890abcdef1234567890abcd',
  trunkDeleted: true,
  phoneNumbersRecorded: 2,
  phoneNumbers: ['+447111111111', '+447222222222']
}

[INFO] Releasing phone numbers from Twilio {
  subaccountId: '69199436c98895ff97a17e95',
  phoneNumberCount: 2,
  phoneNumbers: ['+447111111111', '+447222222222']
}

[INFO] Phone numbers released from Twilio {
  subaccountId: '69199436c98895ff97a17e95',
  phoneNumbersReleased: 2,
  phoneNumbersFailed: 0,
  releasedNumbers: ['+447111111111', '+447222222222']
}
```

### Trunk Already Deleted (Skipped)
```
[INFO] Deleting Twilio trunk for subaccount {
  subaccountId: '69199436c98895ff97a17e95'
}

[INFO] Found trunk SID to delete {
  subaccountId: '69199436c98895ff97a17e95',
  trunkSid: 'TK1234567890abcdef1234567890abcd'
}

[INFO] Trunk not found in Twilio (may have been deleted already) {
  subaccountId: '69199436c98895ff97a17e95',
  trunkSid: 'TK1234567890abcdef1234567890abcd'
}

[INFO] Twilio trunk deleted successfully {
  subaccountId: '69199436c98895ff97a17e95',
  trunkSid: 'TK1234567890abcdef1234567890abcd',
  trunkDeleted: false,
  skipped: true
}

[INFO] No phone numbers to release from Twilio {
  subaccountId: '69199436c98895ff97a17e95'
}
```

---

## Code References

### Database Server
- **Service:** `/Users/weekend/scalai/v2/scalai-database-server/src/services/twilioService.js`
  - Method: `deleteTrunkForSubaccount(subaccountId, userId)` - Deletes trunk and returns phone numbers
  - Method: `releasePhoneNumbersFromTwilio(subaccountId, phoneNumbersToRelease)` - Releases phone numbers
  
- **Controller:** `/Users/weekend/scalai/v2/scalai-database-server/src/controllers/connectorController.js`
  - Method: `deleteTwilioTrunk(req, res)` - Trunk deletion endpoint
  - Method: `releasePhoneNumbersFromTwilio(req, res)` - Phone release endpoint
  
- **Routes:** `/Users/weekend/scalai/v2/scalai-database-server/src/routes/connectorRoutes.js`
  - `DELETE /:subaccountId/twilio-trunk` - Delete trunk endpoint
  - `POST /:subaccountId/twilio/release-phone-numbers` - Release numbers endpoint

### Tenant Manager
- **Controller:** `/Users/weekend/scalai/v2/scalai-tenant-manager/src/controllers/subaccountController.js`
  - Method: `deleteSubaccount(req, res, next)`
  - Lines: 1210-1363 (Complete deletion flow with trunk-first logic)

---

## Troubleshooting

### Issue: "Phone number release failed"
**Cause:** Phone number may have already been released or doesn't exist in Twilio

**Solution:**
- Check the `phoneNumbersFailed` array in the response for details
- Review logs for specific phone number errors
- The deletion process continues even if some numbers fail to release
- Failed numbers can be manually released via Twilio Console if needed

### Issue: "No trunk SID found in connector metadata"
**Cause:** Twilio was never set up for this subaccount, or trunk was already cleaned up

**Solution:**
- This is expected behavior - no action needed
- Trunk deletion is skipped gracefully
- No phone numbers will be released (empty list)

### Issue: Trunk deletion takes too long
**Cause:** Network latency with Twilio API

**Solution:**
- Trunk deletion is non-blocking - subaccount deletion continues
- Check logs to see if deletion eventually completed
- If stuck, manually delete trunk via Twilio Console

### Issue: Phone numbers still showing in Twilio after deletion
**Cause:** Release process may have failed for some numbers

**Solution:**
- Check the logs for `phoneNumbersFailed` entries
- Identify which specific numbers failed and why
- Manually release failed numbers via Twilio Console
- Common causes: network issues, API rate limits, invalid number states

---

## Summary

✅ **NEW: Trunk-first deletion order** - Trunk deleted before phone numbers for better tracking
✅ **Automatic trunk cleanup** is now part of subaccount deletion  
✅ **Phone numbers are recorded** before trunk deletion for complete audit trail
✅ **Phone numbers are released** from Twilio after trunk deletion
✅ **Complete cleanup** from all systems (Twilio → Retell → MongoDB)
✅ **Metadata is cleaned up** from database
✅ **Safe and resilient** - handles errors gracefully
✅ **Fully logged** - easy to debug and monitor

### Key Improvements

**Better Flow:**
- Trunk deleted first (with phone number recording)
- Phone numbers released after trunk deletion
- Retell and MongoDB cleaned up last

**Benefits:**
- ✅ No dependency issues between trunk and phone numbers
- ✅ Complete audit trail of what was deleted
- ✅ Simplified error handling
- ✅ More resilient to network issues
- ✅ Prevents orphaned resources

This ensures that when you delete a subaccount, **all Twilio resources are properly cleaned up** in the correct order, preventing orphaned trunks and reducing costs.

