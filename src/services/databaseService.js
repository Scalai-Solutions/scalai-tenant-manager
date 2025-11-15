const axios = require('axios');
const config = require('../../config/config');
const Logger = require('../utils/logger');
const http = require('http');
const https = require('https');

class DatabaseService {
  constructor() {
    this.baseURL = config.databaseServer.url;
    this.timeout = config.databaseServer.timeout || 30000;
    this.serviceToken = config.serviceToken.token;
    
    // Create axios instance with default config
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: this.timeout,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'ScalAI-TenantManager/1.0.0'
      },
      // Enable keep-alive with proper socket management
      httpAgent: new http.Agent({ 
        keepAlive: true,
        keepAliveMsecs: 1000,
        maxSockets: 50,
        maxFreeSockets: 10,
        timeout: 60000,
        freeSocketTimeout: 30000
      }),
      httpsAgent: new https.Agent({ 
        keepAlive: true,
        keepAliveMsecs: 1000,
        maxSockets: 50,
        maxFreeSockets: 10,
        timeout: 60000,
        freeSocketTimeout: 30000
      })
    });
    
    // Add request interceptor for logging
    this.client.interceptors.request.use(
      (config) => {
        Logger.debug('Database service request', {
          method: config.method?.toUpperCase(),
          url: config.url,
          baseURL: config.baseURL
        });
        return config;
      },
      (error) => {
        Logger.error('Database service request error', { error: error.message });
        return Promise.reject(error);
      }
    );
    
    // Add response interceptor for logging and retry logic
    this.client.interceptors.response.use(
      (response) => {
        Logger.debug('Database service response', {
          status: response.status,
          url: response.config.url,
          method: response.config.method?.toUpperCase()
        });
        return response;
      },
      async (error) => {
        const config = error.config;
        
        Logger.error('Database service response error', {
          status: error.response?.status,
          statusText: error.response?.statusText,
          url: error.config?.url,
          method: error.config?.method?.toUpperCase(),
          message: error.message,
          code: error.code,
          errno: error.errno,
          syscall: error.syscall
        });
        
        // Retry on connection errors (ECONNRESET, ETIMEDOUT, ECONNREFUSED, etc.)
        const retryableErrors = ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND', 'EPIPE'];
        const shouldRetry = retryableErrors.includes(error.code) && (!config.__retryCount || config.__retryCount < 3);
        
        if (shouldRetry) {
          config.__retryCount = (config.__retryCount || 0) + 1;
          Logger.warn(`Retrying database request (attempt ${config.__retryCount}/3)`, {
            url: config.url,
            method: config.method,
            error: error.code
          });
          
          // Wait a bit before retrying (exponential backoff)
          await new Promise(resolve => setTimeout(resolve, 100 * config.__retryCount));
          
          return this.client(config);
        }
        
        return Promise.reject(error);
      }
    );
  }
  
  /**
   * Configure Twilio regulatory bundle for a subaccount
   * @param {string} subaccountId - The subaccount ID
   * @param {string} bundleSid - The Twilio bundle SID (e.g., "BU...")
   * @returns {Promise<Object>} Response object with success status
   */
  async configureTwilioBundle(subaccountId, bundleSid) {
    try {
      Logger.info('Configuring Twilio bundle for subaccount', { subaccountId, bundleSid });
      
      const response = await this.client.put(
        `/api/connectors/${subaccountId}/twilio/bundle`,
        { bundleSid },
        {
          headers: {
            'X-Service-Token': this.serviceToken,
            'X-Service-Name': config.server.serviceName
          }
        }
      );
      
      if (response.data.success) {
        Logger.info('Twilio bundle configured successfully', {
          subaccountId,
          bundleSid
        });
        return {
          success: true,
          message: response.data.message,
          bundleSid: response.data.bundleSid
        };
      } else {
        Logger.warn('Failed to configure Twilio bundle', {
          subaccountId,
          bundleSid,
          message: response.data.message
        });
        return {
          success: false,
          message: response.data.message || 'Failed to configure bundle'
        };
      }
    } catch (error) {
      Logger.error('Failed to configure Twilio bundle', {
        subaccountId,
        bundleSid,
        error: error.message,
        status: error.response?.status,
        data: error.response?.data
      });
      
      // Handle specific error cases
      if (error.response?.status === 400) {
        return {
          success: false,
          message: error.response.data?.message || 'Invalid bundle SID'
        };
      } else if (error.response?.status === 404) {
        return {
          success: false,
          message: 'Twilio connector not found for subaccount'
        };
      } else {
        return {
          success: false,
          message: 'Database service unavailable'
        };
      }
    }
  }
  
  /**
   * Health check for database service
   */
  async healthCheck() {
    try {
      const response = await this.client.get('/api/health', {
        timeout: 5000, // Shorter timeout for health check
        headers: {
          'X-Service-Token': this.serviceToken,
          'X-Service-Name': config.server.serviceName
        }
      });
      
      return {
        status: 'healthy',
        message: 'Database service is responding',
        responseTime: response.headers['x-response-time'] || 'unknown'
      };
    } catch (error) {
      Logger.warn('Database service health check failed', {
        error: error.message,
        status: error.response?.status
      });
      
      return {
        status: 'unhealthy',
        message: error.message,
        error: error.response?.status || 'CONNECTION_ERROR'
      };
    }
  }
}

// Create singleton instance
const databaseService = new DatabaseService();

module.exports = databaseService;

