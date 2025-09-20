const axios = require('axios');
const config = require('../../config/config');
const Logger = require('../utils/logger');

class AuthService {
  constructor() {
    this.baseURL = config.authServer.url;
    this.timeout = config.authServer.timeout || 10000;
    
    // Create axios instance with default config
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: this.timeout,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'ScalAI-TenantManager/1.0.0'
      }
    });
    
    // Add request interceptor for logging
    this.client.interceptors.request.use(
      (config) => {
        Logger.debug('Auth service request', {
          method: config.method?.toUpperCase(),
          url: config.url,
          baseURL: config.baseURL
        });
        return config;
      },
      (error) => {
        Logger.error('Auth service request error', { error: error.message });
        return Promise.reject(error);
      }
    );
    
    // Add response interceptor for logging
    this.client.interceptors.response.use(
      (response) => {
        Logger.debug('Auth service response', {
          status: response.status,
          url: response.config.url,
          method: response.config.method?.toUpperCase()
        });
        return response;
      },
      (error) => {
        Logger.error('Auth service response error', {
          status: error.response?.status,
          statusText: error.response?.statusText,
          url: error.config?.url,
          method: error.config?.method?.toUpperCase(),
          message: error.message
        });
        return Promise.reject(error);
      }
    );
  }
  
  // Get user by email
  async getUserByEmail(email, token) {
    try {
      Logger.debug('Fetching user by email from auth service', { email });
      
      const response = await this.client.get('/api/users/search', {
        params: { email },
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (response.data.success && response.data.data.user) {
        Logger.debug('User found via auth service', { 
          email, 
          userId: response.data.data.user.id 
        });
        return {
          success: true,
          user: response.data.data.user
        };
      } else {
        Logger.debug('User not found via auth service', { email });
        return {
          success: false,
          message: 'User not found'
        };
      }
    } catch (error) {
      Logger.error('Failed to fetch user from auth service', {
        email,
        error: error.message,
        status: error.response?.status
      });
      
      // Handle specific error cases
      if (error.response?.status === 404) {
        return {
          success: false,
          message: 'User not found'
        };
      } else if (error.response?.status === 401) {
        return {
          success: false,
          message: 'Authentication failed'
        };
      } else {
        return {
          success: false,
          message: 'Auth service unavailable'
        };
      }
    }
  }
  
  // Get user by ID
  async getUserById(userId, token) {
    try {
      Logger.debug('Fetching user by ID from auth service', { userId });
      
      const response = await this.client.get(`/api/users/${userId}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (response.data.success && response.data.data.user) {
        Logger.debug('User found via auth service', { userId });
        return {
          success: true,
          user: response.data.data.user
        };
      } else {
        return {
          success: false,
          message: 'User not found'
        };
      }
    } catch (error) {
      Logger.error('Failed to fetch user by ID from auth service', {
        userId,
        error: error.message,
        status: error.response?.status
      });
      
      if (error.response?.status === 404) {
        return {
          success: false,
          message: 'User not found'
        };
      } else if (error.response?.status === 401) {
        return {
          success: false,
          message: 'Authentication failed'
        };
      } else {
        return {
          success: false,
          message: 'Auth service unavailable'
        };
      }
    }
  }
  
  // Validate user exists and is active
  async validateUser(email, token) {
    try {
      const result = await this.getUserByEmail(email, token);
      
      if (!result.success) {
        return {
          success: false,
          message: result.message
        };
      }
      
      const user = result.user;
      
      // Check if user is active
      if (!user.isActive) {
        return {
          success: false,
          message: 'User is inactive'
        };
      }
      
      return {
        success: true,
        user: {
          id: user._id || user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          isActive: user.isActive
        }
      };
    } catch (error) {
      Logger.error('User validation failed', {
        email,
        error: error.message
      });
      
      return {
        success: false,
        message: 'User validation failed'
      };
    }
  }
  
  // Health check for auth service
  async healthCheck() {
    try {
      const response = await this.client.get('/api/health', {
        timeout: 5000 // Shorter timeout for health check
      });
      
      return {
        status: 'healthy',
        message: 'Auth service is responding',
        responseTime: response.headers['x-response-time'] || 'unknown'
      };
    } catch (error) {
      Logger.warn('Auth service health check failed', {
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
const authService = new AuthService();

module.exports = authService; 