const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const config = require('../config/config');

// Import routes
const subaccountRoutes = require('./routes/subaccountRoutes');
const userRoutes = require('./routes/userRoutes');
const healthRoutes = require('./routes/healthRoutes');

// Import middleware
const { generalLimiter } = require('./middleware/rateLimiter');
const errorHandler = require('./middleware/errorHandler');

// Import monitoring (simplified for now)
// const HealthService = require('../../shared/monitoring/healthService');
// const MetricsCollector = require('../../shared/monitoring/metricsCollector');

// Create Express app
const app = express();

// Trust proxy for accurate IP addresses (required for Heroku)
app.set('trust proxy', 1);

// Initialize monitoring (simplified for now)
// const healthService = new HealthService('tenant-manager');
// const metricsCollector = new MetricsCollector('tenant-manager');

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));

// CORS configuration
app.use(cors({
  origin: config.cors.origin,
  credentials: config.cors.credentials,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Compression
app.use(compression());

// Request parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging
if (config.server.nodeEnv !== 'test') {
  app.use(morgan(config.logging.format));
}

// Simple health endpoint (before any middleware)
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    service: 'tenant-manager',
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime()),
    pid: process.pid
  });
});

// Rate limiting
app.use(generalLimiter);

// Metrics collection middleware (disabled for now)
// app.use(metricsCollector.createExpressMiddleware());

// Health and info routes
app.use('/api', healthRoutes);

// API routes
app.use('/api/subaccounts', subaccountRoutes);
app.use('/api', userRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'ScalAI Tenant Manager API',
    version: '1.0.0',
    timestamp: new Date(),
    endpoints: {
      health: '/api/health',
      subaccounts: '/api/subaccounts',
      documentation: '/api/docs'
    }
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found',
    code: 'NOT_FOUND',
    path: req.originalUrl
  });
});

// Error handling middleware
app.use(errorHandler);

// Start monitoring (disabled for now)
// healthService.start();
// metricsCollector.start();

// Register health checks (disabled for now)
// healthService.registerHealthCheck('database', 
//   HealthService.createDatabaseHealthCheck(require('./utils/database').connection, 'mongodb'),
//   { critical: true }
// );

// healthService.registerHealthCheck('redis',
//   HealthService.createRedisHealthCheck(require('./services/redisService').client, 'redis'),
//   { critical: true }
// );

module.exports = app; 