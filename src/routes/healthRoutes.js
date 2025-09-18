const express = require('express');
const router = express.Router();

// Basic health check endpoint
router.get('/health', (req, res) => {
  // Simple synchronous health check to avoid hanging
  res.json({
    success: true,
    status: 'healthy',
    service: 'tenant-manager',
    timestamp: new Date(),
    uptime: process.uptime(),
    pid: process.pid
  });
});

// Detailed health check endpoint
router.get('/health/detailed', async (req, res) => {
  try {
    const health = {
      status: 'healthy',
      service: 'tenant-manager',
      timestamp: new Date(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      pid: process.pid,
      environment: process.env.NODE_ENV,
      version: '1.0.0'
    };
    
    res.json({
      success: true,
      data: health
    });
  } catch (error) {
    res.status(503).json({
      success: false,
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date()
    });
  }
});

// Service info endpoint
router.get('/info', (req, res) => {
  res.json({
    success: true,
    data: {
      service: 'tenant-manager',
      version: '1.0.0',
      description: 'Multi-tenant subaccount management microservice',
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development'
    }
  });
});

module.exports = router; 