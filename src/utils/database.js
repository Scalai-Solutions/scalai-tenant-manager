const mongoose = require('mongoose');
const config = require('../../config/config');
const Logger = require('./logger');

class Database {
  static connection = null;
  static isConnected = false;

  static async connect() {
    try {
      if (this.isConnected) {
        Logger.info('Database already connected');
        return this.connection;
      }

      const connectionOptions = {
        dbName: config.database.dbName,
        maxPoolSize: 20, // Increased for tenant manager
        minPoolSize: 5,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        connectTimeoutMS: 10000,
        heartbeatFrequencyMS: 10000,
        maxIdleTimeMS: 30000,
        family: 4,
        
        // Additional options for stability
        retryWrites: true,
        retryReads: true,
        readPreference: 'primary'
      };

      Logger.info('Connecting to MongoDB...', {
        host: this.maskConnectionString(config.database.mongoUri),
        database: config.database.dbName,
        options: connectionOptions
      });

      this.connection = await mongoose.connect(config.database.mongoUri, connectionOptions);
      this.isConnected = true;
      
      Logger.info('MongoDB connected successfully', {
        database: config.database.dbName,
        environment: config.server.nodeEnv,
        readyState: mongoose.connection.readyState
      });

      // Setup connection event handlers
      this.setupEventHandlers();

      return this.connection;
    } catch (error) {
      this.isConnected = false;
      Logger.error('MongoDB connection failed', { 
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  static setupEventHandlers() {
    // Connection events
    mongoose.connection.on('connected', () => {
      this.isConnected = true;
      Logger.info('Mongoose connected to MongoDB');
    });

    mongoose.connection.on('error', (err) => {
      this.isConnected = false;
      Logger.error('MongoDB connection error', { 
        error: err.message,
        code: err.code 
      });
    });

    mongoose.connection.on('disconnected', () => {
      this.isConnected = false;
      Logger.warn('MongoDB disconnected');
    });

    mongoose.connection.on('reconnected', () => {
      this.isConnected = true;
      Logger.info('MongoDB reconnected');
    });

    mongoose.connection.on('close', () => {
      this.isConnected = false;
      Logger.info('MongoDB connection closed');
    });

    // Process events
    process.on('SIGINT', async () => {
      await this.disconnect();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      await this.disconnect();
      process.exit(0);
    });
  }

  static async disconnect() {
    try {
      if (this.connection && this.isConnected) {
        await mongoose.connection.close();
        this.isConnected = false;
        this.connection = null;
        Logger.info('MongoDB connection closed gracefully');
      }
    } catch (error) {
      Logger.error('Error closing MongoDB connection', { 
        error: error.message 
      });
      throw error;
    }
  }

  static async healthCheck() {
    try {
      if (!this.isConnected) {
        return {
          status: 'disconnected',
          message: 'Not connected to database'
        };
      }

      // Ping the database
      await mongoose.connection.db.admin().ping();
      
      const stats = await this.getConnectionStats();
      
      return {
        status: 'connected',
        message: 'Database connection healthy',
        stats
      };
    } catch (error) {
      Logger.error('Database health check failed', { 
        error: error.message 
      });
      
      return {
        status: 'unhealthy',
        message: error.message,
        error: error.code
      };
    }
  }

  static async getConnectionStats() {
    try {
      if (!this.isConnected) {
        return null;
      }

      const adminDb = mongoose.connection.db.admin();
      const serverStatus = await adminDb.serverStatus();
      
      return {
        readyState: mongoose.connection.readyState,
        host: mongoose.connection.host,
        port: mongoose.connection.port,
        name: mongoose.connection.name,
        collections: Object.keys(mongoose.connection.collections).length,
        
        // Connection pool stats
        pool: {
          totalCreated: serverStatus.connections?.totalCreated || 0,
          current: serverStatus.connections?.current || 0,
          available: serverStatus.connections?.available || 0,
          active: serverStatus.connections?.active || 0
        },
        
        // Memory stats
        memory: {
          resident: serverStatus.mem?.resident || 0,
          virtual: serverStatus.mem?.virtual || 0,
          mapped: serverStatus.mem?.mapped || 0
        },
        
        // Operation stats
        operations: {
          insert: serverStatus.opcounters?.insert || 0,
          query: serverStatus.opcounters?.query || 0,
          update: serverStatus.opcounters?.update || 0,
          delete: serverStatus.opcounters?.delete || 0,
          command: serverStatus.opcounters?.command || 0
        },
        
        uptime: serverStatus.uptime,
        version: serverStatus.version
      };
    } catch (error) {
      Logger.error('Failed to get connection stats', { 
        error: error.message 
      });
      return null;
    }
  }

  static getReadyState() {
    const states = {
      0: 'disconnected',
      1: 'connected',
      2: 'connecting',
      3: 'disconnecting'
    };
    
    return {
      code: mongoose.connection.readyState,
      state: states[mongoose.connection.readyState] || 'unknown'
    };
  }

  static isHealthy() {
    return this.isConnected && mongoose.connection.readyState === 1;
  }

  // Clear database (development only)
  static async clearDatabase() {
    if (config.server.nodeEnv !== 'development' && config.server.nodeEnv !== 'test') {
      throw new Error('Database clearing is only allowed in development and test modes');
    }

    try {
      Logger.warn('Clearing database - this should only happen in development/test');
      
      const collections = await mongoose.connection.db.collections();
      
      for (const collection of collections) {
        await collection.deleteMany({});
        Logger.debug(`Cleared collection: ${collection.collectionName}`);
      }
      
      Logger.info('Database cleared successfully', {
        collectionsCleared: collections.length
      });
    } catch (error) {
      Logger.error('Error clearing database', { 
        error: error.message 
      });
      throw error;
    }
  }

  // Create indexes for all models
  static async createIndexes() {
    try {
      Logger.info('Creating database indexes...');
      
      // Get all models and create their indexes
      const models = mongoose.models;
      const indexPromises = [];
      
      for (const modelName in models) {
        const model = models[modelName];
        indexPromises.push(
          model.createIndexes().catch(error => {
            Logger.error(`Failed to create indexes for ${modelName}`, {
              model: modelName,
              error: error.message
            });
          })
        );
      }
      
      await Promise.all(indexPromises);
      
      Logger.info('Database indexes created successfully', {
        models: Object.keys(models).length
      });
    } catch (error) {
      Logger.error('Error creating database indexes', { 
        error: error.message 
      });
      throw error;
    }
  }

  // Utility to mask connection string for logging
  static maskConnectionString(connectionString) {
    if (!connectionString) return '';
    
    try {
      const url = new URL(connectionString);
      if (url.password) {
        url.password = '***';
      }
      if (url.username) {
        url.username = url.username.substring(0, 3) + '***';
      }
      return url.toString();
    } catch {
      return connectionString.replace(/\/\/.*@/, '//***:***@');
    }
  }

  // Get database statistics
  static async getDbStats() {
    try {
      if (!this.isConnected) {
        return null;
      }

      const stats = await mongoose.connection.db.stats();
      
      return {
        database: stats.db,
        collections: stats.collections,
        objects: stats.objects,
        avgObjSize: stats.avgObjSize,
        dataSize: stats.dataSize,
        storageSize: stats.storageSize,
        indexes: stats.indexes,
        indexSize: stats.indexSize,
        fileSize: stats.fileSize,
        fsTotalSize: stats.fsTotalSize,
        fsUsedSize: stats.fsUsedSize
      };
    } catch (error) {
      Logger.error('Failed to get database stats', { 
        error: error.message 
      });
      return null;
    }
  }

  // Transaction support
  static async withTransaction(operation) {
    const session = await mongoose.startSession();
    
    try {
      Logger.debug('Starting database transaction');
      
      const result = await session.withTransaction(async () => {
        return await operation(session);
      });
      
      Logger.debug('Database transaction completed successfully');
      return result;
    } catch (error) {
      Logger.error('Database transaction failed', { 
        error: error.message 
      });
      throw error;
    } finally {
      await session.endSession();
    }
  }
}

module.exports = Database; 