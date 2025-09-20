const mongoose = require('mongoose');
const crypto = require('crypto');
const config = require('../../config/config');

const subaccountSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Subaccount name is required'],
    trim: true,
    minlength: [2, 'Name must be at least 2 characters long'],
    maxlength: [100, 'Name cannot exceed 100 characters']
  },
  
  description: {
    type: String,
    trim: true,
    maxlength: [500, 'Description cannot exceed 500 characters']
  },
  
  // Encrypted MongoDB connection string
  mongodbUrl: {
    type: String,
    required: [true, 'MongoDB URL is required'],
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
  
  databaseName: {
    type: String,
    required: [true, 'Database name is required'],
    trim: true,
    match: [/^[a-zA-Z0-9_-]+$/, 'Database name can only contain letters, numbers, underscores, and hyphens']
  },
  
  // Status and configuration
  isActive: {
    type: Boolean,
    default: true
  },
  
  // Connection pool settings
  maxConnections: {
    type: Number,
    default: 5,
    min: 1,
    max: 20
  },
  
  // Schema validation settings
  enforceSchema: {
    type: Boolean,
    default: true
  },
  
  allowedCollections: {
    type: [mongoose.Schema.Types.Mixed], // Allow both strings and objects
    default: [],
    validate: {
      validator: function(collections) {
        // Allow empty array
        if (!collections || collections.length === 0) return true;
        
        // Check if it contains wildcard
        const hasWildcard = collections.some(item => item === '*');
        
        if (hasWildcard) {
          // If wildcard is present, it should be the only item
          return collections.length === 1 && collections[0] === '*';
        }
        
        // Otherwise, all items should be collection objects
        return collections.every(item => 
          item && 
          typeof item === 'object' && 
          typeof item.name === 'string' &&
          item.name.length > 0
        );
      },
      message: 'Invalid allowedCollections: use ["*"] for all collections or array of collection objects'
    }
  },
  
  // Ownership and management
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Usage statistics
  stats: {
    totalQueries: { type: Number, default: 0 },
    lastAccessed: { type: Date },
    totalUsers: { type: Number, default: 0 },
    avgResponseTime: { type: Number, default: 0 }
  },
  
  // Rate limiting per subaccount
  rateLimits: {
    queriesPerMinute: { type: Number, default: 100 },
    queriesPerHour: { type: Number, default: 1000 },
    queriesPerDay: { type: Number, default: 10000 }
  },
  
  // Maintenance settings
  maintenanceMode: {
    type: Boolean,
    default: false
  },
  
  maintenanceMessage: {
    type: String,
    trim: true
  }
}, {
  timestamps: true,
  toJSON: {
    transform: function(doc, ret) {
      delete ret.mongodbUrl;
      delete ret.encryptionIV;
      delete ret.encryptionAuthTag;
      delete ret.__v;
      return ret;
    }
  }
});

// Indexes for performance
subaccountSchema.index({ createdBy: 1 });
subaccountSchema.index({ isActive: 1 });
subaccountSchema.index({ name: 1, createdBy: 1 });

// Static method to encrypt connection string
subaccountSchema.statics.encryptConnectionString = function(connectionString) {
  try {
    const algorithm = 'aes-256-cbc';
    const secretKey = crypto.scryptSync(config.encryption.key, 'subaccount-salt', 32);
    const iv = crypto.randomBytes(16);
    
    const cipher = crypto.createCipheriv(algorithm, secretKey, iv);
    let encrypted = cipher.update(connectionString, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    return {
      encrypted,
      iv: iv.toString('hex'),
      authTag: 'cbc-mode' // CBC doesn't use auth tag, but field is required
    };
  } catch (error) {
    throw new Error('Failed to encrypt connection string: ' + error.message);
  }
};

// Static method to decrypt connection string
subaccountSchema.statics.decryptConnectionString = function(encrypted, iv, authTag) {
  try {
    const algorithm = 'aes-256-cbc';
    const secretKey = crypto.scryptSync(config.encryption.key, 'subaccount-salt', 32);
    
    const decipher = crypto.createDecipheriv(algorithm, secretKey, Buffer.from(iv, 'hex'));
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    throw new Error('Failed to decrypt connection string: ' + error.message);
  }
};

// Instance method to get decrypted connection string
subaccountSchema.methods.getDecryptedUrl = function() {
  if (!this.mongodbUrl || !this.encryptionIV || !this.encryptionAuthTag) {
    throw new Error('Missing encryption data');
  }
  
  return this.constructor.decryptConnectionString(
    this.mongodbUrl,
    this.encryptionIV,
    this.encryptionAuthTag
  );
};

// Pre-save middleware to encrypt connection string
subaccountSchema.pre('save', function(next) {
  // Always encrypt mongodbUrl if it's present and not already encrypted
  if (this.mongodbUrl && (!this.encryptionIV || !this.encryptionAuthTag)) {
    try {
      console.log('[DEBUG] Encrypting MongoDB URL...');
      const encryptionResult = this.constructor.encryptConnectionString(this.mongodbUrl);
      this.mongodbUrl = encryptionResult.encrypted;
      this.encryptionIV = encryptionResult.iv;
      this.encryptionAuthTag = encryptionResult.authTag;
      console.log('[DEBUG] MongoDB URL encrypted successfully');
    } catch (error) {
      console.log('[DEBUG] Encryption failed:', error.message);
      return next(error);
    }
  }
  next();
});

// Instance method to test connection
subaccountSchema.methods.testConnection = async function() {
  const mongoose = require('mongoose');
  let testConnection;
  
  try {
    const connectionUrl = this.getDecryptedUrl();
    testConnection = await mongoose.createConnection(connectionUrl, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000
    });
    
    // Test basic operation
    await testConnection.db.admin().ping();
    
    return { success: true, message: 'Connection successful' };
  } catch (error) {
    return { success: false, message: error.message };
  } finally {
    if (testConnection) {
      await testConnection.close();
    }
  }
};

// Instance method to update stats
subaccountSchema.methods.updateStats = function(responseTime) {
  this.stats.totalQueries += 1;
  this.stats.lastAccessed = new Date();
  
  // Calculate rolling average response time
  if (this.stats.avgResponseTime === 0) {
    this.stats.avgResponseTime = responseTime;
  } else {
    this.stats.avgResponseTime = (this.stats.avgResponseTime * 0.9) + (responseTime * 0.1);
  }
  
  return this.save();
};

const Subaccount = mongoose.model('Subaccount', subaccountSchema);

module.exports = Subaccount; 