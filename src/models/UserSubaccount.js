const mongoose = require('mongoose');

const userSubaccountSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  subaccountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subaccount',
    required: true
  },
  
  // Permission system
  permissions: {
    // Basic CRUD permissions
    read: {
      type: Boolean,
      default: true
    },
    write: {
      type: Boolean,
      default: false
    },
    delete: {
      type: Boolean,
      default: false
    },
    admin: {
      type: Boolean,
      default: false
    },
    
    // Collection-specific permissions
    collections: [{
      name: {
        type: String,
        required: true
      },
      permissions: {
        read: { type: Boolean, default: true },
        write: { type: Boolean, default: false },
        delete: { type: Boolean, default: false }
      }
    }],
    
    // Query limitations
    queryLimits: {
      maxDocuments: {
        type: Number,
        default: 1000
      },
      maxQueryTime: {
        type: Number,
        default: 30000 // 30 seconds
      },
      allowAggregation: {
        type: Boolean,
        default: true
      },
      allowTextSearch: {
        type: Boolean,
        default: true
      }
    }
  },
  
  // Role within this subaccount
  role: {
    type: String,
    enum: ['viewer', 'editor', 'admin', 'owner'],
    default: 'viewer'
  },
  
  // Status
  isActive: {
    type: Boolean,
    default: true
  },
  
  // Invitation and access tracking
  invitedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  invitedAt: {
    type: Date
  },
  
  acceptedAt: {
    type: Date
  },
  
  lastAccessed: {
    type: Date
  },
  
  // Usage statistics for this user-subaccount relationship
  stats: {
    totalQueries: { type: Number, default: 0 },
    totalDocumentsRead: { type: Number, default: 0 },
    totalDocumentsWritten: { type: Number, default: 0 },
    avgResponseTime: { type: Number, default: 0 },
    lastQueryAt: { type: Date }
  },
  
  // Rate limiting overrides (if different from subaccount defaults)
  rateLimitOverrides: {
    queriesPerMinute: { type: Number },
    queriesPerHour: { type: Number },
    queriesPerDay: { type: Number }
  },
  
  // Temporary access settings
  temporaryAccess: {
    enabled: { type: Boolean, default: false },
    expiresAt: { type: Date },
    reason: { type: String }
  }
}, {
  timestamps: true,
  toJSON: {
    transform: function(doc, ret) {
      delete ret.__v;
      return ret;
    }
  }
});

// Compound indexes for performance
userSubaccountSchema.index({ userId: 1, subaccountId: 1 }, { unique: true });
userSubaccountSchema.index({ userId: 1, isActive: 1 });
userSubaccountSchema.index({ subaccountId: 1, isActive: 1 });
userSubaccountSchema.index({ role: 1 });
userSubaccountSchema.index({ 'temporaryAccess.expiresAt': 1 }, { 
  expireAfterSeconds: 0,
  partialFilterExpression: { 'temporaryAccess.enabled': true }
});

// Static method to check if user has access to subaccount
userSubaccountSchema.statics.hasAccess = async function(userId, subaccountId, operation = 'read') {
  try {
    // First, check if the user is a super_admin or admin - they have access to all subaccounts
    const User = require('./User');
    const user = await User.findById(userId);
    
    if (user && (user.role === 'super_admin' || user.role === 'admin')) {
      return {
        hasAccess: true,
        permissions: {
          read: true,
          write: true,
          delete: true,
          admin: true
        },
        role: user.role === 'super_admin' ? 'super_admin' : 'admin'
      };
    }

    const userSubaccount = await this.findOne({
      userId,
      subaccountId,
      isActive: true
    }).populate('subaccountId', 'isActive maintenanceMode');
    
    if (!userSubaccount) {
      return { hasAccess: false, reason: 'User not associated with subaccount' };
    }
    
    // Check if subaccount is active
    if (!userSubaccount.subaccountId.isActive) {
      return { hasAccess: false, reason: 'Subaccount is inactive' };
    }
    
    // Check maintenance mode
    if (userSubaccount.subaccountId.maintenanceMode && !userSubaccount.permissions.admin) {
      return { hasAccess: false, reason: 'Subaccount is in maintenance mode' };
    }
    
    // Check temporary access expiration
    if (userSubaccount.temporaryAccess.enabled) {
      if (new Date() > userSubaccount.temporaryAccess.expiresAt) {
        return { hasAccess: false, reason: 'Temporary access expired' };
      }
    }
    
    // Check operation permission
    const hasPermission = userSubaccount.hasPermission(operation);
    if (!hasPermission) {
      return { hasAccess: false, reason: `Insufficient permissions for ${operation}` };
    }
    
    return {
      hasAccess: true,
      userSubaccount,
      permissions: userSubaccount.permissions,
      role: userSubaccount.role
    };
  } catch (error) {
    return { hasAccess: false, reason: 'Error checking access: ' + error.message };
  }
};

// Instance method to check specific permission
userSubaccountSchema.methods.hasPermission = function(operation) {
  // Admin and owner have all permissions
  if (this.permissions.admin || this.role === 'owner' || this.role === 'admin') {
    return true;
  }
  
  // Check basic permissions
  switch (operation.toLowerCase()) {
    case 'read':
    case 'find':
    case 'get':
      return this.permissions.read;
    
    case 'write':
    case 'insert':
    case 'update':
    case 'create':
      return this.permissions.write;
    
    case 'delete':
    case 'remove':
      return this.permissions.delete;
    
    case 'admin':
    case 'manage':
      return this.permissions.admin || this.role === 'admin';
    
    default:
      return false;
  }
};

// Instance method to check collection-specific permission
userSubaccountSchema.methods.hasCollectionPermission = function(collectionName, operation) {
  // Check if there are collection-specific permissions
  const collectionPerm = this.permissions.collections.find(c => c.name === collectionName);
  
  if (collectionPerm) {
    switch (operation.toLowerCase()) {
      case 'read':
        return collectionPerm.permissions.read;
      case 'write':
        return collectionPerm.permissions.write;
      case 'delete':
        return collectionPerm.permissions.delete;
      default:
        return false;
    }
  }
  
  // Fall back to general permissions
  return this.hasPermission(operation);
};

// Instance method to update usage statistics
userSubaccountSchema.methods.updateStats = function(operation, documentsAffected = 0, responseTime = 0) {
  this.stats.totalQueries += 1;
  this.stats.lastQueryAt = new Date();
  this.lastAccessed = new Date();
  
  if (operation === 'read' || operation === 'find') {
    this.stats.totalDocumentsRead += documentsAffected;
  } else if (operation === 'write' || operation === 'insert' || operation === 'update') {
    this.stats.totalDocumentsWritten += documentsAffected;
  }
  
  // Calculate rolling average response time
  if (this.stats.avgResponseTime === 0) {
    this.stats.avgResponseTime = responseTime;
  } else {
    this.stats.avgResponseTime = (this.stats.avgResponseTime * 0.9) + (responseTime * 0.1);
  }
  
  return this.save();
};

// Static method to get user's subaccounts with permissions
userSubaccountSchema.statics.getUserSubaccounts = async function(userId, options = {}) {
  const query = { userId, isActive: true };
  
  // Add filters if provided
  if (options.role) {
    query.role = options.role;
  }
  
  const userSubaccounts = await this.find(query)
    .populate('subaccountId', 'name description isActive stats createdAt')
    .sort({ createdAt: -1 });
  
  return userSubaccounts.map(us => ({
    subaccount: us.subaccountId,
    permissions: us.permissions,
    role: us.role,
    stats: us.stats,
    lastAccessed: us.lastAccessed,
    joinedAt: us.createdAt
  }));
};

// Static method to get subaccount users with their permissions
userSubaccountSchema.statics.getSubaccountUsers = async function(subaccountId, options = {}) {
  const query = { subaccountId, isActive: true };
  
  if (options.role) {
    query.role = options.role;
  }
  
  const userSubaccounts = await this.find(query)
    .populate('userId', 'firstName lastName email lastLogin')
    .sort({ createdAt: -1 });
  
  return userSubaccounts.map(us => ({
    user: us.userId,
    permissions: us.permissions,
    role: us.role,
    stats: us.stats,
    lastAccessed: us.lastAccessed,
    joinedAt: us.createdAt,
    invitedBy: us.invitedBy
  }));
};

// Pre-save middleware to set default permissions based on role
userSubaccountSchema.pre('save', function(next) {
  if (this.isModified('role')) {
    switch (this.role) {
      case 'viewer':
        this.permissions.read = true;
        this.permissions.write = false;
        this.permissions.delete = false;
        this.permissions.admin = false;
        break;
      
      case 'editor':
        this.permissions.read = true;
        this.permissions.write = true;
        this.permissions.delete = false;
        this.permissions.admin = false;
        break;
      
      case 'admin':
        this.permissions.read = true;
        this.permissions.write = true;
        this.permissions.delete = true;
        this.permissions.admin = true;
        break;
      
      case 'owner':
        this.permissions.read = true;
        this.permissions.write = true;
        this.permissions.delete = true;
        this.permissions.admin = true;
        break;
    }
  }
  next();
});

const UserSubaccount = mongoose.model('UserSubaccount', userSubaccountSchema);

module.exports = UserSubaccount; 