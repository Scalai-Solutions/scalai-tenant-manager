const mongoose = require('mongoose');

const connectorSchema = new mongoose.Schema({
  type: {
    type: String,
    required: [true, 'Connector type is required'],
    trim: true
  },
  
  name: {
    type: String,
    required: [true, 'Connector name is required'],
    trim: true,
    maxlength: [100, 'Name cannot exceed 100 characters']
  },
  
  description: {
    type: String,
    trim: true,
    maxlength: [500, 'Description cannot exceed 500 characters']
  },
  
  // Configuration specific to each connector type
  config: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
    required: true
  },
  
  // Icon or logo URL for the connector
  icon: {
    type: String,
    trim: true
  },
  
  // Connector status
  isActive: {
    type: Boolean,
    default: true
  },
  
  // Whether this connector is available for all subaccounts
  isGlobal: {
    type: Boolean,
    default: false
  },
  
  // Category for organizing connectors
  category: {
    type: String,
    enum: ['calendar', 'communication', 'video', 'productivity', 'custom', 'other'],
    default: 'other'
  },
  
  // Version for tracking connector updates
  version: {
    type: String,
    default: '1.0.0'
  },
  
  // Metadata
  metadata: {
    author: String,
    documentation: String,
    supportUrl: String,
    tags: [String]
  },
  
  // Created by (admin user)
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
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

// Indexes for performance
connectorSchema.index({ type: 1 });
connectorSchema.index({ isActive: 1 });
connectorSchema.index({ isGlobal: 1 });
connectorSchema.index({ category: 1 });
connectorSchema.index({ type: 1, isActive: 1 });

// Virtual for full name with version
connectorSchema.virtual('displayName').get(function() {
  return `${this.name} v${this.version}`;
});

// Instance method to validate config based on connector type
connectorSchema.methods.validateConfig = function() {
  const requiredFields = {
    google_calendar: ['calendarId'],
    outlook_calendar: ['clientId', 'clientSecret', 'tenantId'],
    zoom: ['apiKey', 'apiSecret'],
    slack: ['botToken', 'appToken'],
    teams: ['webhookUrl'],
    webhook: ['url', 'method'],
    custom: []
  };
  
  const required = requiredFields[this.type] || [];
  const missing = required.filter(field => !this.config[field]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required config fields for ${this.type}: ${missing.join(', ')}`);
  }
  
  return true;
};

// Static method to get default config template for a connector type
connectorSchema.statics.getConfigTemplate = function(type) {
  const templates = {
    google_calendar: {
      apiKey: '',
      clientId: '',
      clientSecret: '',
      redirectUri: '',
      scopes: ['calendar.readonly', 'calendar.events']
    },
    outlook_calendar: {
      clientId: '',
      clientSecret: '',
      tenantId: '',
      redirectUri: '',
      scopes: ['Calendars.Read', 'Calendars.ReadWrite']
    },
    zoom: {
      apiKey: '',
      apiSecret: '',
      webhookToken: ''
    },
    slack: {
      botToken: '',
      appToken: '',
      signingSecret: ''
    },
    teams: {
      webhookUrl: '',
      appId: '',
      appPassword: ''
    },
    webhook: {
      url: '',
      method: 'POST',
      headers: {},
      authentication: {
        type: 'none' // 'none', 'basic', 'bearer', 'apiKey'
      }
    },
    custom: {}
  };
  
  return templates[type] || {};
};

const Connector = mongoose.model('Connector', connectorSchema);

module.exports = Connector;

