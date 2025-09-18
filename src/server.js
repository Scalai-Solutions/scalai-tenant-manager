const app = require('./app');
const config = require('../config/config');
const Logger = require('./utils/logger');
const Database = require('./utils/database');
const redisService = require('./services/redisService');

const PORT = config.server.port;

async function startServer() {
  try {
    Logger.info('Starting Tenant Manager Server...');

    // Connect to MongoDB (optional for now)
    try {
      await Database.connect();
      Logger.info('Database connected');
    } catch (error) {
      Logger.warn('Database connection failed, continuing without database', { error: error.message });
    }

    // Connect to Redis (optional for now)
    try {
      await redisService.connect();
      Logger.info('Redis connected');
    } catch (error) {
      Logger.warn('Redis connection failed, continuing without Redis', { error: error.message });
    }

    // Start HTTP server
    const server = app.listen(PORT, () => {
      Logger.info(`🏢 Tenant Manager running on port ${PORT} in ${config.server.nodeEnv} mode`);
      Logger.info('Tenant Manager ready to handle requests');
    });

    // Graceful shutdown
    const gracefulShutdown = async (signal) => {
      Logger.info(`${signal} received, shutting down gracefully`);
      
      server.close(async () => {
        try {
          Logger.info('HTTP server closed');
          
          // Close database connection
          await Database.disconnect();
          Logger.info('Database connection closed');
          
          // Close Redis connection
          await redisService.disconnect();
          Logger.info('Redis connection closed');
          
          Logger.info('Tenant Manager shutdown complete');
          process.exit(0);
        } catch (error) {
          Logger.error('Error during graceful shutdown', { error: error.message });
          process.exit(1);
        }
      });
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    return server;
  } catch (error) {
    Logger.error('Failed to start Tenant Manager', { error: error.message });
    process.exit(1);
  }
}

// Start the server
startServer(); 