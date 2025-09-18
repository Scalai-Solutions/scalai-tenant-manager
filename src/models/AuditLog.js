const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  // User and subaccount identification
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  subaccountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subaccount',
    required: true,
    index: true
  },
  
  // Operation details
  operation: {
    type: String,
    required: true,
    enum: [
      'find', 'findOne', 'findById',
      'insert', 'insertOne', 'insertMany',
      'update', 'updateOne', 'updateMany',
      'delete', 'deleteOne', 'deleteMany',
      'aggregate', 'count', 'distinct',
      'createCollection', 'dropCollection',
      'createIndex', 'dropIndex',
      'admin'
    ],
    index: true
  },
  
  // Database and collection
  databaseName: {
    type: String,
    required: true
  },
  
  collectionName: {
    type: String,
    required: true,
    index: true
  },
  
  // Query details (sanitized for logging)
  queryDetails: {
    // Original query (sensitive data removed)
    query: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    
    // Query options (limit, sort, etc.)
    options: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    
    // Update data (for update operations)
    updateData: {
      type: mongoose.Schema.Types.Mixed
    },
    
    // Aggregation pipeline (for aggregate operations)
    pipeline: [{
      type: mongoose.Schema.Types.Mixed
    }]
  },
  
  // Execution results
  result: {
    success: {
      type: Boolean,
      required: true,
      index: true
    },
    
    documentsAffected: {
      type: Number,
      default: 0
    },
    
    documentsReturned: {
      type: Number,
      default: 0
    },
    
    executionTimeMs: {
      type: Number,
      required: true
    },
    
    // Error details if operation failed
    error: {
      message: String,
      code: String,
      stack: String
    }
  },
  
  // Request context
  requestContext: {
    // Client information
    ipAddress: {
      type: String,
      required: true,
      index: true
    },
    
    userAgent: {
      type: String,
      required: true
    },
    
    // Request headers (sanitized)
    headers: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    
    // API endpoint called
    endpoint: {
      type: String,
      required: true
    },
    
    // HTTP method
    method: {
      type: String,
      required: true,
      enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']
    },
    
    // Request ID for tracing
    requestId: {
      type: String,
      required: true,
      index: true
    }
  },
  
  // Security analysis
  securityFlags: {
    // Risk level assessment
    riskLevel: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'low',
      index: true
    },
    
    // Suspicious activity indicators
    suspiciousPatterns: [{
      pattern: String,
      severity: {
        type: String,
        enum: ['info', 'warning', 'error', 'critical']
      },
      description: String
    }],
    
    // Geographic anomalies
    geoAnomaly: {
      detected: { type: Boolean, default: false },
      previousCountry: String,
      currentCountry: String,
      distance: Number // km
    },
    
    // Time-based anomalies
    timeAnomaly: {
      detected: { type: Boolean, default: false },
      usualHours: [Number], // Array of usual hours (0-23)
      currentHour: Number
    },
    
    // Query complexity analysis
    queryComplexity: {
      score: { type: Number, default: 0 },
      factors: [{
        factor: String,
        impact: Number
      }]
    }
  },
  
  // Performance metrics
  performance: {
    // Connection pool stats at time of query
    poolStats: {
      activeConnections: Number,
      availableConnections: Number,
      waitingClients: Number
    },
    
    // Memory usage
    memoryUsage: {
      heapUsed: Number,
      heapTotal: Number,
      external: Number
    },
    
    // Database performance
    dbStats: {
      indexHits: Number,
      indexMisses: Number,
      documentsExamined: Number,
      documentsReturned: Number
    }
  },
  
  // Compliance and audit trail
  compliance: {
    // Data classification
    dataClassification: {
      type: String,
      enum: ['public', 'internal', 'confidential', 'restricted'],
      default: 'internal'
    },
    
    // Retention period
    retentionDays: {
      type: Number,
      default: 90
    },
    
    // Compliance tags
    tags: [{
      type: String,
      enum: ['gdpr', 'hipaa', 'pci', 'sox', 'iso27001']
    }],
    
    // Data processing purpose
    purpose: {
      type: String,
      enum: ['analytics', 'reporting', 'operations', 'maintenance', 'audit']
    }
  }
}, {
  timestamps: true,
  // TTL index for automatic cleanup
  index: { createdAt: 1 },
  expireAfterSeconds: 7776000, // 90 days default
  toJSON: {
    transform: function(doc, ret) {
      delete ret.__v;
      return ret;
    }
  }
});

// Additional indexes for performance
auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ userId: 1, createdAt: -1 });
auditLogSchema.index({ subaccountId: 1, createdAt: -1 });
auditLogSchema.index({ 'result.success': 1, createdAt: -1 });
auditLogSchema.index({ 'securityFlags.riskLevel': 1, createdAt: -1 });
auditLogSchema.index({ 'requestContext.ipAddress': 1, createdAt: -1 });

// Compound indexes for common queries
auditLogSchema.index({ 
  userId: 1, 
  subaccountId: 1, 
  operation: 1, 
  createdAt: -1 
});

auditLogSchema.index({ 
  'securityFlags.riskLevel': 1, 
  'result.success': 1, 
  createdAt: -1 
});

// Static method to log database operation
auditLogSchema.statics.logOperation = async function(operationData) {
  try {
    // Sanitize sensitive data
    const sanitizedQuery = this.sanitizeQuery(operationData.queryDetails?.query);
    const sanitizedHeaders = this.sanitizeHeaders(operationData.requestContext?.headers);
    
    // Analyze security risks
    const securityAnalysis = await this.analyzeSecurityRisks(operationData);
    
    // Create audit log entry
    const auditLog = new this({
      userId: operationData.userId,
      subaccountId: operationData.subaccountId,
      operation: operationData.operation,
      databaseName: operationData.databaseName,
      collectionName: operationData.collectionName,
      
      queryDetails: {
        ...operationData.queryDetails,
        query: sanitizedQuery
      },
      
      result: operationData.result,
      
      requestContext: {
        ...operationData.requestContext,
        headers: sanitizedHeaders
      },
      
      securityFlags: securityAnalysis,
      performance: operationData.performance || {},
      compliance: operationData.compliance || {}
    });
    
    await auditLog.save();
    
    // Trigger alerts if high risk
    if (securityAnalysis.riskLevel === 'high' || securityAnalysis.riskLevel === 'critical') {
      await this.triggerSecurityAlert(auditLog);
    }
    
    return auditLog;
  } catch (error) {
    console.error('Failed to create audit log:', error);
    // Don't throw error to avoid breaking the main operation
    return null;
  }
};

// Static method to sanitize query for logging
auditLogSchema.statics.sanitizeQuery = function(query) {
  if (!query || typeof query !== 'object') return query;
  
  const sensitiveFields = ['password', 'token', 'secret', 'key', 'ssn', 'creditCard'];
  const sanitized = JSON.parse(JSON.stringify(query));
  
  const sanitizeRecursive = (obj) => {
    for (const key in obj) {
      if (sensitiveFields.some(field => key.toLowerCase().includes(field))) {
        obj[key] = '[REDACTED]';
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        sanitizeRecursive(obj[key]);
      }
    }
  };
  
  sanitizeRecursive(sanitized);
  return sanitized;
};

// Static method to sanitize headers
auditLogSchema.statics.sanitizeHeaders = function(headers) {
  if (!headers) return {};
  
  const sanitized = { ...headers };
  const sensitiveHeaders = ['authorization', 'cookie', 'x-api-key'];
  
  sensitiveHeaders.forEach(header => {
    if (sanitized[header]) {
      sanitized[header] = '[REDACTED]';
    }
  });
  
  return sanitized;
};

// Static method to analyze security risks
auditLogSchema.statics.analyzeSecurityRisks = async function(operationData) {
  const analysis = {
    riskLevel: 'low',
    suspiciousPatterns: [],
    geoAnomaly: { detected: false },
    timeAnomaly: { detected: false },
    queryComplexity: { score: 0, factors: [] }
  };
  
  // Analyze operation type risk
  const highRiskOperations = ['delete', 'deleteMany', 'dropCollection', 'dropIndex'];
  if (highRiskOperations.includes(operationData.operation)) {
    analysis.riskLevel = 'medium';
    analysis.suspiciousPatterns.push({
      pattern: 'high_risk_operation',
      severity: 'warning',
      description: `High-risk operation: ${operationData.operation}`
    });
  }
  
  // Analyze query complexity
  if (operationData.queryDetails?.pipeline?.length > 10) {
    analysis.queryComplexity.score += 30;
    analysis.queryComplexity.factors.push({
      factor: 'complex_aggregation',
      impact: 30
    });
  }
  
  // Analyze time patterns
  const currentHour = new Date().getHours();
  if (currentHour < 6 || currentHour > 22) {
    analysis.timeAnomaly.detected = true;
    analysis.timeAnomaly.currentHour = currentHour;
    analysis.riskLevel = analysis.riskLevel === 'low' ? 'medium' : analysis.riskLevel;
    analysis.suspiciousPatterns.push({
      pattern: 'unusual_time',
      severity: 'info',
      description: `Query executed at unusual hour: ${currentHour}`
    });
  }
  
  // Analyze failure patterns
  if (!operationData.result.success) {
    analysis.suspiciousPatterns.push({
      pattern: 'operation_failure',
      severity: 'error',
      description: operationData.result.error?.message || 'Operation failed'
    });
  }
  
  // Set overall risk level based on complexity score
  if (analysis.queryComplexity.score > 50) {
    analysis.riskLevel = 'high';
  }
  
  return analysis;
};

// Static method to trigger security alerts
auditLogSchema.statics.triggerSecurityAlert = async function(auditLog) {
  // Implementation would integrate with alerting system
  console.log('SECURITY ALERT:', {
    userId: auditLog.userId,
    subaccountId: auditLog.subaccountId,
    operation: auditLog.operation,
    riskLevel: auditLog.securityFlags.riskLevel,
    patterns: auditLog.securityFlags.suspiciousPatterns,
    timestamp: auditLog.createdAt
  });
  
  // Could integrate with:
  // - Email notifications
  // - Slack/Discord webhooks
  // - Security incident management systems
  // - Real-time monitoring dashboards
};

// Static method to get audit statistics
auditLogSchema.statics.getAuditStats = async function(filters = {}) {
  const matchStage = {};
  
  if (filters.userId) matchStage.userId = filters.userId;
  if (filters.subaccountId) matchStage.subaccountId = filters.subaccountId;
  if (filters.startDate) matchStage.createdAt = { $gte: filters.startDate };
  if (filters.endDate) matchStage.createdAt = { ...matchStage.createdAt, $lte: filters.endDate };
  
  const stats = await this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: null,
        totalOperations: { $sum: 1 },
        successfulOperations: {
          $sum: { $cond: [{ $eq: ['$result.success', true] }, 1, 0] }
        },
        failedOperations: {
          $sum: { $cond: [{ $eq: ['$result.success', false] }, 1, 0] }
        },
        avgExecutionTime: { $avg: '$result.executionTimeMs' },
        totalDocumentsAffected: { $sum: '$result.documentsAffected' },
        riskDistribution: {
          $push: '$securityFlags.riskLevel'
        }
      }
    }
  ]);
  
  return stats[0] || {
    totalOperations: 0,
    successfulOperations: 0,
    failedOperations: 0,
    avgExecutionTime: 0,
    totalDocumentsAffected: 0,
    riskDistribution: []
  };
};

const AuditLog = mongoose.model('AuditLog', auditLogSchema);

module.exports = AuditLog; 