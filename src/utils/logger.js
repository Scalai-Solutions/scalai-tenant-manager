const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const config = require('../../config/config');

// Custom log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf(({ timestamp, level, message, service, ...meta }) => {
    return JSON.stringify({
      timestamp,
      level,
      service: service || config.server.serviceName,
      message,
      ...meta
    });
  })
);

// Create transports array
const transports = [
  // Console transport
  new winston.transports.Console({
    level: config.logging.level,
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple(),
      winston.format.printf(({ timestamp, level, message, service, ...meta }) => {
        const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
        return `${timestamp} [${service || 'tenant-manager'}] ${level}: ${message} ${metaStr}`;
      })
    )
  })
];

// Add file transport if enabled
if (config.logging.file.enabled) {
  transports.push(
    new DailyRotateFile({
      filename: config.logging.file.filename.replace('.log', '-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: config.logging.file.maxSize,
      maxFiles: config.logging.file.maxFiles,
      level: config.logging.level,
      format: logFormat
    })
  );

  // Separate error log file
  transports.push(
    new DailyRotateFile({
      filename: config.logging.file.filename.replace('.log', '-error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: config.logging.file.maxSize,
      maxFiles: config.logging.file.maxFiles,
      level: 'error',
      format: logFormat
    })
  );
}

// Create logger instance
const logger = winston.createLogger({
  level: config.logging.level,
  format: logFormat,
  defaultMeta: { 
    service: config.server.serviceName,
    version: process.env.npm_package_version || '1.0.0',
    environment: config.server.nodeEnv
  },
  transports,
  exitOnError: false
});

// Handle uncaught exceptions and unhandled rejections
if (config.server.nodeEnv === 'production') {
  logger.exceptions.handle(
    new winston.transports.File({ filename: 'logs/exceptions.log' })
  );

  logger.rejections.handle(
    new winston.transports.File({ filename: 'logs/rejections.log' })
  );
}

// Custom logging methods with context
class Logger {
  static info(message, meta = {}) {
    logger.info(message, this.addContext(meta));
  }

  static error(message, meta = {}) {
    logger.error(message, this.addContext(meta));
  }

  static warn(message, meta = {}) {
    logger.warn(message, this.addContext(meta));
  }

  static debug(message, meta = {}) {
    logger.debug(message, this.addContext(meta));
  }

  static verbose(message, meta = {}) {
    logger.verbose(message, this.addContext(meta));
  }

  // Request logging
  static request(req, message = 'HTTP Request', meta = {}) {
    const requestMeta = {
      method: req.method,
      url: req.url,
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent'),
      userId: req.user?.id,
      requestId: req.requestId,
      ...meta
    };

    logger.info(message, this.addContext(requestMeta));
  }

  // Response logging
  static response(req, res, message = 'HTTP Response', meta = {}) {
    const responseMeta = {
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      responseTime: res.responseTime,
      userId: req.user?.id,
      requestId: req.requestId,
      ...meta
    };

    if (res.statusCode >= 400) {
      logger.error(message, this.addContext(responseMeta));
    } else {
      logger.info(message, this.addContext(responseMeta));
    }
  }

  // Database operation logging
  static database(operation, collection, meta = {}) {
    const dbMeta = {
      operation,
      collection,
      database: config.database.dbName,
      ...meta
    };

    logger.info(`Database ${operation}`, this.addContext(dbMeta));
  }

  // Security event logging
  static security(event, severity = 'info', meta = {}) {
    const securityMeta = {
      event,
      severity,
      category: 'security',
      ...meta
    };

    const logLevel = severity === 'critical' || severity === 'high' ? 'error' : 
                     severity === 'medium' ? 'warn' : 'info';

    logger[logLevel](`Security Event: ${event}`, this.addContext(securityMeta));
  }

  // Performance logging
  static performance(metric, value, unit = 'ms', meta = {}) {
    const perfMeta = {
      metric,
      value,
      unit,
      category: 'performance',
      ...meta
    };

    logger.info(`Performance: ${metric}`, this.addContext(perfMeta));
  }

  // Audit logging
  static audit(action, resource, meta = {}) {
    const auditMeta = {
      action,
      resource,
      category: 'audit',
      timestamp: new Date().toISOString(),
      ...meta
    };

    logger.info(`Audit: ${action} on ${resource}`, this.addContext(auditMeta));
  }

  // Add common context to all logs
  static addContext(meta = {}) {
    return {
      pid: process.pid,
      memory: process.memoryUsage(),
      uptime: process.uptime(),
      ...meta
    };
  }

  // Get logger instance for advanced usage
  static getInstance() {
    return logger;
  }

  // Create child logger with persistent context
  static child(context = {}) {
    return logger.child(context);
  }

  // Log levels check
  static isDebugEnabled() {
    return logger.isDebugEnabled();
  }

  static isInfoEnabled() {
    return logger.isInfoEnabled();
  }

  // Flush logs (useful for testing)
  static async flush() {
    return new Promise((resolve) => {
      logger.on('finish', resolve);
      logger.end();
    });
  }
}

// Export both the class and winston instance
module.exports = Logger;
module.exports.winston = logger; 