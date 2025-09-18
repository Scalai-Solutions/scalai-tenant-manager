require('dotenv').config();

const config = {
  server: {
    port: process.env.TENANT_PORT || 3003,
    nodeEnv: process.env.NODE_ENV || 'development',
    serviceName: 'tenant-manager'
  },
  
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '24h'
  },
  
  database: {
    mongoUri: process.env.MONGODB_URI,
    dbName: process.env.DB_NAME || 'scalai_auth'
  },
  
  // Encryption settings for subaccount connection strings
  encryption: {
    key: process.env.ENCRYPTION_KEY,
    algorithm: 'aes-256-gcm'
  },
  
  // Redis configuration for session management and caching
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB) || 0,
    ttl: parseInt(process.env.REDIS_TTL) || 3600, // 1 hour default
    
    // Cache prefixes
    prefixes: {
      subaccount: 'subaccount:',
      userSubaccount: 'user_subaccount:',
      permissions: 'permissions:',
      session: 'session:'
    }
  },
  
  // Auth server configuration
  authServer: {
    url: process.env.AUTH_SERVER_URL || 'http://localhost:3001',
    timeout: 10000
  },
  
  // Database server configuration
  databaseServer: {
    url: process.env.DATABASE_SERVER_URL || 'http://localhost:3002',
    timeout: 30000
  },
  
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true
  },
  
  // Rate limiting configuration
  rateLimiting: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // limit each IP to 1000 requests per windowMs
    standardHeaders: true,
    legacyHeaders: false,
    
    // Per-user limits
    perUser: {
      windowMs: 60 * 1000, // 1 minute
      max: 100 // 100 requests per minute per user
    },
    
    // Admin endpoints have higher limits
    admin: {
      windowMs: 60 * 1000,
      max: 500
    }
  },
  
  // Security settings
  security: {
    // Maximum subaccounts per user
    maxSubaccountsPerUser: 50,
    
    // Maximum users per subaccount
    maxUsersPerSubaccount: 1000,
    
    // Connection string validation
    allowedHosts: process.env.ALLOWED_MONGODB_HOSTS?.split(',') || [],
    
    // Session settings
    sessionTimeout: 24 * 60 * 60 * 1000, // 24 hours
    
    // Audit settings
    auditRetentionDays: 90,
    enableDetailedAudit: process.env.ENABLE_DETAILED_AUDIT === 'true'
  },
  
  // Monitoring and health checks
  monitoring: {
    healthCheckInterval: 30000, // 30 seconds
    metricsEnabled: process.env.ENABLE_METRICS === 'true',
    
    // Connection pool monitoring
    poolMonitoring: {
      enabled: true,
      alertThreshold: 0.8 // Alert when 80% of connections are used
    }
  },
  
  // Logging configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    format: process.env.LOG_FORMAT || 'combined',
    
    // File logging
    file: {
      enabled: process.env.FILE_LOGGING === 'true',
      filename: 'logs/tenant-manager.log',
      maxSize: '20m',
      maxFiles: '14d'
    }
  }
};

// Validate required config
const requiredConfig = [
  'JWT_SECRET',
  'MONGODB_URI',
  'ENCRYPTION_KEY'
];

const optionalButRecommended = [
  'REDIS_PASSWORD',
  'ALLOWED_MONGODB_HOSTS'
];

// Check required configuration
requiredConfig.forEach(key => {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
});

// Warn about missing optional configuration
if (config.server.nodeEnv === 'production') {
  optionalButRecommended.forEach(key => {
    if (!process.env[key]) {
      console.warn(`Missing recommended environment variable for production: ${key}`);
    }
  });
}

// Environment-specific overrides
if (config.server.nodeEnv === 'production') {
  config.logging.level = 'warn';
  config.security.enableDetailedAudit = true;
  config.rateLimiting.max = 500; // Stricter rate limiting in production
}

if (config.server.nodeEnv === 'development') {
  config.logging.level = 'debug';
  config.monitoring.healthCheckInterval = 60000; // Less frequent in development
}

module.exports = config; 