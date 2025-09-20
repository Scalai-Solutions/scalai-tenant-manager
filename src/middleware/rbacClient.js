const axios = require('axios');
const config = require('../../config/config');
const Logger = require('../utils/logger');

// RBAC client for communicating with auth server
class RBACClient {
  constructor() {
    this.authServerURL = config.authServer.url;
    this.cache = new Map(); // Simple in-memory cache
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
  }

  // Check permission via auth server
  async checkPermission(userId, resourceName, requiredPermission, subaccountId = null, token) {
    try {
      const cacheKey = `${userId}:${resourceName}:${requiredPermission}:${subaccountId || 'global'}`;
      
      // Check cache first
      const cached = this.cache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout) {
        Logger.debug('RBAC permission from cache', { cacheKey, result: cached.result });
        return cached.result;
      }

      // Make request to auth server
      const response = await axios.get(`${this.authServerURL}/api/rbac/permissions/check`, {
        params: { userId, resourceName, subaccountId },
        headers: { 'Authorization': `Bearer ${token}` },
        timeout: 5000
      });

      const result = response.data.data.permissions[requiredPermission];
      
      // Cache the result
      this.cache.set(cacheKey, {
        result,
        timestamp: Date.now()
      });

      Logger.debug('RBAC permission from auth server', { 
        userId, 
        resourceName, 
        requiredPermission, 
        result 
      });

      return result;
    } catch (error) {
      Logger.error('RBAC permission check failed', {
        error: error.message,
        userId,
        resourceName,
        requiredPermission,
        subaccountId
      });
      
      // Fail closed - deny permission on error
      return {
        hasPermission: false,
        reason: 'RBAC service unavailable',
        effectiveRole: 'unknown'
      };
    }
  }

  // Clear cache for user
  clearUserCache(userId) {
    for (const [key] of this.cache.entries()) {
      if (key.startsWith(`${userId}:`)) {
        this.cache.delete(key);
      }
    }
  }

  // Clear all cache
  clearCache() {
    this.cache.clear();
  }
}

// Singleton instance
const rbacClient = new RBACClient();

// RBAC middleware factory for tenant manager
const requirePermission = (resourceName, requiredPermission = 'read', options = {}) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required for permission check',
          code: 'AUTH_REQUIRED'
        });
      }

      const userId = req.user.id;
      const subaccountId = options.extractSubaccountId ? 
        options.extractSubaccountId(req) : 
        req.params.subaccountId || req.body.subaccountId || null;

      // Extract token from request
      const token = req.headers.authorization?.split(' ')[1];
      if (!token) {
        return res.status(401).json({
          success: false,
          message: 'Access token required for permission check',
          code: 'TOKEN_REQUIRED'
        });
      }

      Logger.debug('RBAC permission check (tenant-manager)', {
        userId,
        resourceName,
        requiredPermission,
        subaccountId,
        endpoint: req.originalUrl
      });

      // Check permission via RBAC service
      const permissionResult = await rbacClient.checkPermission(
        userId,
        resourceName,
        requiredPermission,
        subaccountId,
        token
      );

      if (!permissionResult.hasPermission) {
        Logger.security('Permission denied by RBAC', 'medium', {
          userId,
          userEmail: req.user.email,
          userRole: req.user.role,
          resourceName,
          requiredPermission,
          subaccountId,
          reason: permissionResult.reason,
          endpoint: req.originalUrl,
          clientIP: req.ip
        });

        return res.status(403).json({
          success: false,
          message: permissionResult.reason || 'Permission denied',
          code: 'PERMISSION_DENIED',
          details: {
            resource: resourceName,
            requiredPermission,
            userRole: req.user.role,
            effectiveRole: permissionResult.effectiveRole
          }
        });
      }

      // Permission granted
      req.permission = {
        resourceName,
        requiredPermission,
        effectiveRole: permissionResult.effectiveRole,
        reason: permissionResult.reason,
        subaccountId
      };

      Logger.audit('Permission granted by RBAC', resourceName, {
        userId,
        requiredPermission,
        effectiveRole: permissionResult.effectiveRole,
        reason: permissionResult.reason,
        subaccountId
      });

      next();
    } catch (error) {
      Logger.error('RBAC middleware error (tenant-manager)', {
        error: error.message,
        userId: req.user?.id,
        resourceName,
        requiredPermission
      });

      // Fail closed on error
      res.status(500).json({
        success: false,
        message: 'Permission check failed',
        code: 'RBAC_ERROR'
      });
    }
  };
};

// Simplified role check middleware
const requireRole = (requiredRole, options = {}) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required',
          code: 'AUTH_REQUIRED'
        });
      }

      const userRole = req.user.role;
      const subaccountId = options.extractSubaccountId ? 
        options.extractSubaccountId(req) : 
        req.params.subaccountId || req.body.subaccountId || null;

      // Super admin always passes
      if (userRole === 'super_admin') {
        req.roleCheck = { passed: true, effectiveRole: 'super_admin' };
        return next();
      }

      // Global admin check
      if (userRole === 'admin' && (requiredRole === 'admin' || requiredRole === 'user')) {
        req.roleCheck = { passed: true, effectiveRole: 'admin' };
        return next();
      }

      // For subaccount context, check subaccount-specific role
      if (subaccountId && userRole === 'user') {
        // This would need to check UserSubaccount relationship
        // For now, implement basic role hierarchy
        const roleHierarchy = ['user', 'admin', 'super_admin'];
        const requiredIndex = roleHierarchy.indexOf(requiredRole);
        const userIndex = roleHierarchy.indexOf(userRole);
        
        if (userIndex >= requiredIndex) {
          req.roleCheck = { passed: true, effectiveRole: userRole };
          return next();
        }
      }

      // Role check failed
      Logger.security('Role check failed (tenant-manager)', 'medium', {
        userId: req.user.id,
        userRole,
        requiredRole,
        subaccountId,
        endpoint: req.originalUrl
      });

      res.status(403).json({
        success: false,
        message: `${requiredRole} role required`,
        code: 'INSUFFICIENT_ROLE',
        details: { userRole, requiredRole }
      });

    } catch (error) {
      Logger.error('Role check error (tenant-manager)', {
        error: error.message,
        userId: req.user?.id
      });

      res.status(500).json({
        success: false,
        message: 'Role check failed',
        code: 'ROLE_CHECK_ERROR'
      });
    }
  };
};

// Pre-built permission checks for tenant manager
const tenantPermissions = {
  subaccounts: {
    read: requirePermission('subaccount_management', 'read'),
    write: requirePermission('subaccount_management', 'write'),
    admin: requirePermission('subaccount_management', 'admin')
  },
  users: {
    read: requirePermission('user_subaccount_management', 'read'),
    write: requirePermission('user_subaccount_management', 'write'),
    admin: requirePermission('user_subaccount_management', 'admin')
  }
};

module.exports = {
  rbacClient,
  requirePermission,
  requireRole,
  tenantPermissions
}; 