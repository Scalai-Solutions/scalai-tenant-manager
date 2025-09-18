const app = require('./app');
const config = require('../config/config');
const Logger = require('./utils/logger');
const Database = require("./utils/database");
const redisManager = require('./services/redisManager');

const PORT = config.server.port;

async function startServer() {
  try {
    Logger.info('Starting Tenant Manager Server...');

    // Connect to MongoDB (optional - continue if fails)
    try {
      await Database.connect();
      Logger.info('Database connected successfully');
    } catch (error) {
      Logger.warn('Database connection failed, continuing without database', { error: error.message });
    }

    // Initialize Redis (optional - continue if fails)
    await redisManager.initialize();

    // Start HTTP server
    const server = app.listen(PORT, () => {
      Logger.info(`🏢 Tenant Manager running on port ${PORT} in ${config.server.nodeEnv} mode`);
      Logger.info('Tenant Manager ready to handle requests');
    });

    // Graceful shutdown handling
    const gracefulShutdown = async (signal) => {
      Logger.info(`Received ${signal}, starting graceful shutdown...`);
      
      server.close(async () => {
        try {
          Logger.info('HTTP server closed');
          
          // Close database connection
          await Database.disconnect();
          
          // Close Redis connection
          try {
            await redisManager.shutdown();
            Logger.info("Redis connection closed");
          } catch (error) {
            Logger.warn("Error closing Redis connection", { error: error.message });
          }
          Logger.info('Database connection closed');
          
          Logger.info('Tenant Manager shutdown complete');
          process.exit(0);
        } catch (error) {
          Logger.error('Error during graceful shutdown', { error: error.message });
          process.exit(1);
        }
      });
    };

    // Handle shutdown signals
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      Logger.error('Uncaught Exception:', error);
      process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
      Logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
      process.exit(1);
    });

  } catch (error) {
    Logger.error('Failed to start Tenant Manager server:', error);
    process.exit(1);
  }
}

// Start the server
startServer().catch((error) => {
  Logger.error('Server startup failed:', error);
  process.exit(1);
});
