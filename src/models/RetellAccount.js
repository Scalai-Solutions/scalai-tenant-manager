const mongoose = require('mongoose');
const crypto = require('crypto');
const config = require('../../config/config');

const retellAccountSchema = new mongoose.Schema({
  // Encrypted Retell API key
  apiKey: {
    type: String,
    required: [true, 'Retell API key is required'],
    select: false // Never return this in queries by default
  },
  
  // Encryption metadata
  encryptionIV: {
    type: String,
    required: false, // Generated automatically in pre-save
    select: false
  },
  
  encryptionAuthTag: {
    type: String,
    required: false, // Generated automatically in pre-save
    select: false
  },
  
  // Retell account configuration
  accountName: {
    type: String,
    trim: true,
    maxlength: [100, 'Account name cannot exceed 100 characters']
  },
  
  // Status
  isActive: {
    type: Boolean,
    default: true
  },
  
  // Reference to subaccount
  subaccountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subaccount',
    required: true
  },
  
  // Metadata
  lastVerified: {
    type: Date
  },
  
  verificationStatus: {
    type: String,
    enum: ['pending', 'verified', 'failed'],
    default: 'pending'
  },
  
  // Created by
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true,
  toJSON: {
    transform: function(doc, ret) {
      delete ret.apiKey;
      delete ret.encryptionIV;
      delete ret.encryptionAuthTag;
      delete ret.__v;
      return ret;
    }
  }
});

// Indexes for performance
retellAccountSchema.index({ subaccountId: 1 }, { unique: true });
retellAccountSchema.index({ isActive: 1 });
retellAccountSchema.index({ createdBy: 1 });

// Static method to encrypt API key
retellAccountSchema.statics.encryptApiKey = function(apiKey) {
  try {
    const algorithm = 'aes-256-cbc';
    const secretKey = crypto.scryptSync(config.encryption.key, 'retell-salt', 32);
    const iv = crypto.randomBytes(16);
    
    const cipher = crypto.createCipheriv(algorithm, secretKey, iv);
    let encrypted = cipher.update(apiKey, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    return {
      encrypted,
      iv: iv.toString('hex'),
      authTag: 'cbc-mode' // CBC doesn't use auth tag, but field is required
    };
  } catch (error) {
    throw new Error('Failed to encrypt API key: ' + error.message);
  }
};

// Static method to decrypt API key
retellAccountSchema.statics.decryptApiKey = function(encrypted, iv, authTag) {
  try {
    const algorithm = 'aes-256-cbc';
    const secretKey = crypto.scryptSync(config.encryption.key, 'retell-salt', 32);
    
    const decipher = crypto.createDecipheriv(algorithm, secretKey, Buffer.from(iv, 'hex'));
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    throw new Error('Failed to decrypt API key: ' + error.message);
  }
};

// Instance method to get decrypted API key
retellAccountSchema.methods.getDecryptedApiKey = function() {
  if (!this.apiKey || !this.encryptionIV || !this.encryptionAuthTag) {
    throw new Error('Missing encryption data');
  }
  
  return this.constructor.decryptApiKey(
    this.apiKey,
    this.encryptionIV,
    this.encryptionAuthTag
  );
};

// Pre-save middleware to encrypt API key
retellAccountSchema.pre('save', function(next) {
  // Always encrypt apiKey if it's present and not already encrypted
  if (this.apiKey && (!this.encryptionIV || !this.encryptionAuthTag)) {
    try {
      console.log('[DEBUG] Encrypting Retell API key...');
      const encryptionResult = this.constructor.encryptApiKey(this.apiKey);
      this.apiKey = encryptionResult.encrypted;
      this.encryptionIV = encryptionResult.iv;
      this.encryptionAuthTag = encryptionResult.authTag;
      console.log('[DEBUG] Retell API key encrypted successfully');
    } catch (error) {
      console.log('[DEBUG] Encryption failed:', error.message);
      return next(error);
    }
  }
  next();
});

const RetellAccount = mongoose.model('RetellAccount', retellAccountSchema);

module.exports = RetellAccount; 