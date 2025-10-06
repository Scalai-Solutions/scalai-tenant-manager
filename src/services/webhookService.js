const axios = require('axios');
const config = require('../../config/config');
const Logger = require('../utils/logger');
const http = require('http');
const https = require('https');

class WebhookService {
  constructor() {
    this.baseURL = config.webhookServer.url;
    this.timeout = config.webhookServer.timeout || 10000;
    this.serviceToken = config.webhookServer.serviceToken;
    
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
        Logger.debug('Webhook service request', {
          method: config.method?.toUpperCase(),
          url: config.url,
          baseURL: config.baseURL
        });
        return config;
      },
      (error) => {
        Logger.error('Webhook service request error', { error: error.message });
        return Promise.reject(error);
      }
    );
    
    // Add response interceptor for logging and retry logic
    this.client.interceptors.response.use(
      (response) => {
        Logger.debug('Webhook service response', {
          status: response.status,
          url: response.config.url,
          method: response.config.method?.toUpperCase()
        });
        return response;
      },
      async (error) => {
        const config = error.config;
        
        Logger.error('Webhook service response error', {
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
          Logger.warn(`Retrying webhook request (attempt ${config.__retryCount}/3)`, {
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
  
  // Invite email to connect Google Calendar for a subaccount
  async inviteEmailForCalendarIntegration(subaccountId, userEmail) {
    try {
      Logger.debug('Inviting email for calendar integration', { subaccountId, userEmail });
      
      const response = await this.client.post(
        `/api/google/${subaccountId}/connect`,
        { userEmail },
        {
          headers: {
            'X-Service-Token': this.serviceToken,
            'X-Service-Name': config.server.serviceName
          }
        }
      );
      
      if (response.data.success) {
        Logger.info('Email invited for calendar integration', {
          subaccountId,
          userEmail,
          authUrl: response.data.authUrl
        });
        return {
          success: true,
          authUrl: response.data.authUrl,
          message: response.data.message
        };
      } else {
        Logger.warn('Failed to invite email for calendar integration', {
          subaccountId,
          userEmail,
          message: response.data.message
        });
        return {
          success: false,
          message: response.data.message || 'Failed to invite email'
        };
      }
    } catch (error) {
      Logger.error('Failed to invite email for calendar integration', {
        subaccountId,
        userEmail,
        error: error.message,
        status: error.response?.status,
        data: error.response?.data
      });
      
      // Handle specific error cases
      if (error.response?.status === 400) {
        return {
          success: false,
          message: error.response.data?.message || 'Invalid request'
        };
      } else if (error.response?.status === 404) {
        return {
          success: false,
          message: 'Subaccount not found'
        };
      } else if (error.response?.status === 409) {
        return {
          success: false,
          message: error.response.data?.message || 'Email already connected'
        };
      } else {
        return {
          success: false,
          message: 'Webhook service unavailable'
        };
      }
    }
  }
  
  // Health check for webhook service
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
        message: 'Webhook service is responding',
        responseTime: response.headers['x-response-time'] || 'unknown'
      };
    } catch (error) {
      Logger.warn('Webhook service health check failed', {
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
const webhookService = new WebhookService();

module.exports = webhookService;

