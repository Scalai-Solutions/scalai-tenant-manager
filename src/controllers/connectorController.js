const mongoose = require('mongoose');
const Logger = require('../utils/logger');
const Connector = require('../models/Connector');

class ConnectorController {
  // Create a new connector
  static async createConnector(req, res, next) {
    try {
      const userId = req.user.id;
      const {
        type,
        name,
        description,
        config,
        icon,
        isGlobal,
        category,
        version,
        metadata
      } = req.body;

      Logger.audit('Create connector', 'connectors', {
        userId,
        type,
        name
      });

      // Check if connector with same type and name already exists
      const existingConnector = await Connector.findOne({ type, name });
      if (existingConnector) {
        return res.status(409).json({
          success: false,
          message: 'Connector with this type and name already exists',
          code: 'CONNECTOR_EXISTS'
        });
      }

      // Create new connector
      const connector = new Connector({
        type,
        name,
        description,
        config: config || {},
        icon,
        isActive: true,
        isGlobal: isGlobal !== undefined ? isGlobal : false,
        category: category || 'other',
        version: version || '1.0.0',
        metadata: metadata || {},
        createdBy: userId
      });

      // Validate config based on connector type (commented out for flexibility)
      // try {
      //   connector.validateConfig();
      // } catch (validationError) {
      //   return res.status(400).json({
      //     success: false,
      //     message: validationError.message,
      //     code: 'INVALID_CONFIG'
      //   });
      // }

      await connector.save();

      Logger.info('Connector created', {
        userId,
        connectorId: connector._id,
        type: connector.type,
        name: connector.name
      });

      res.status(201).json({
        success: true,
        message: 'Connector created successfully',
        data: {
          id: connector._id,
          type: connector.type,
          name: connector.name,
          description: connector.description,
          icon: connector.icon,
          category: connector.category,
          version: connector.version,
          isActive: connector.isActive,
          isGlobal: connector.isGlobal,
          metadata: connector.metadata,
          createdAt: connector.createdAt,
          config: connector.config
        }
      });

    } catch (error) {
      Logger.error('Failed to create connector', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id
      });
      next(error);
    }
  }

  // Get all connectors
  static async getAllConnectors(req, res, next) {
    try {
      const userId = req.user?.id;
      const { 
        type, 
        category, 
        isActive, 
        isGlobal,
        page = 1, 
        limit = 50 
      } = req.query;

      Logger.audit('Get all connectors', 'connectors', {
        userId,
        query: req.query
      });

      // Build query
      const query = {};
      if (type) query.type = type;
      if (category) query.category = category;
      if (isActive !== undefined) query.isActive = isActive === 'true';
      if (isGlobal !== undefined) query.isGlobal = isGlobal === 'true';

      // Get connectors with pagination
      const skip = (page - 1) * limit;
      const [connectors, total] = await Promise.all([
        Connector.find(query)
          .populate('createdBy', 'firstName lastName email')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit)),
        Connector.countDocuments(query)
      ]);

      Logger.info('Connectors retrieved', {
        userId,
        count: connectors.length,
        total,
        filters: query,
        config: connectors.map(c => c.config)
      });

      res.json({
        success: true,
        message: 'Connectors retrieved successfully',
        data: {
          connectors: connectors.map(c => ({
            id: c._id,
            type: c.type,
            name: c.name,
            description: c.description,
            icon: c.icon,
            category: c.category,
            config: c.config,
            version: c.version,
            isActive: c.isActive,
            isGlobal: c.isGlobal,
            metadata: c.metadata,
            createdBy: c.createdBy ? {
              id: c.createdBy._id,
              name: `${c.createdBy.firstName} ${c.createdBy.lastName}`,
              email: c.createdBy.email
            } : null,
            createdAt: c.createdAt,
            updatedAt: c.updatedAt
          })),
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / limit)
          }
        }
      });

    } catch (error) {
      Logger.error('Failed to get connectors', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id
      });
      next(error);
    }
  }

  // Get single connector by ID
  static async getConnectorById(req, res, next) {
    try {
      const { connectorId } = req.params;
      const userId = req.user?.id;

      Logger.audit('Get connector by ID', 'connectors', {
        userId,
        connectorId
      });

      const connector = await Connector.findById(connectorId)
        .populate('createdBy', 'firstName lastName email');

      if (!connector) {
        return res.status(404).json({
          success: false,
          message: 'Connector not found',
          code: 'CONNECTOR_NOT_FOUND'
        });
      }

      Logger.info('Connector retrieved', {
        userId,
        connectorId
      });

      res.json({
        success: true,
        message: 'Connector retrieved successfully',
        data: {
          id: connector._id,
          type: connector.type,
          name: connector.name,
          description: connector.description,
          icon: connector.icon,
          category: connector.category,
          version: connector.version,
          isActive: connector.isActive,
          isGlobal: connector.isGlobal,
          config: connector.config,
          metadata: connector.metadata,
          createdBy: connector.createdBy ? {
            id: connector.createdBy._id,
            name: `${connector.createdBy.firstName} ${connector.createdBy.lastName}`,
            email: connector.createdBy.email
          } : null,
          createdAt: connector.createdAt,
          updatedAt: connector.updatedAt
        }
      });

    } catch (error) {
      Logger.error('Failed to get connector', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
        connectorId: req.params.connectorId
      });
      next(error);
    }
  }

  // Update connector
  static async updateConnector(req, res, next) {
    try {
      const { connectorId } = req.params;
      const userId = req.user.id;
      const updates = req.body;

      Logger.audit('Update connector', 'connectors', {
        userId,
        connectorId,
        updates: Object.keys(updates)
      });

      const connector = await Connector.findById(connectorId);
      if (!connector) {
        return res.status(404).json({
          success: false,
          message: 'Connector not found',
          code: 'CONNECTOR_NOT_FOUND'
        });
      }

      // Update allowed fields
      const allowedUpdates = [
        'name', 'description', 'config', 'icon', 
        'isActive', 'isGlobal', 'category', 'version', 'metadata'
      ];
      
      allowedUpdates.forEach(field => {
        if (updates[field] !== undefined) {
          connector[field] = updates[field];
        }
      });

      // Validate config if it was updated (commented out for flexibility)
      // if (updates.config) {
      //   try {
      //     connector.validateConfig();
      //   } catch (validationError) {
      //     return res.status(400).json({
      //       success: false,
      //       message: validationError.message,
      //       code: 'INVALID_CONFIG'
      //     });
      //   }
      // }

      await connector.save();

      Logger.info('Connector updated', {
        userId,
        connectorId
      });

      res.json({
        success: true,
        message: 'Connector updated successfully',
        data: {
          id: connector._id,
          type: connector.type,
          name: connector.name,
          description: connector.description,
          icon: connector.icon,
          config: connector.config,
          category: connector.category,
          version: connector.version,
          isActive: connector.isActive,
          isGlobal: connector.isGlobal,
          updatedAt: connector.updatedAt
        }
      });

    } catch (error) {
      Logger.error('Failed to update connector', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
        connectorId: req.params.connectorId
      });
      next(error);
    }
  }

  // Delete connector
  static async deleteConnector(req, res, next) {
    try {
      const { connectorId } = req.params;
      const userId = req.user.id;

      Logger.audit('Delete connector', 'connectors', {
        userId,
        connectorId
      });

      const connector = await Connector.findById(connectorId);
      if (!connector) {
        return res.status(404).json({
          success: false,
          message: 'Connector not found',
          code: 'CONNECTOR_NOT_FOUND'
        });
      }

      await connector.deleteOne();

      Logger.info('Connector deleted', {
        userId,
        connectorId
      });

      res.json({
        success: true,
        message: 'Connector deleted successfully',
        data: {
          id: connectorId,
          deletedAt: new Date()
        }
      });

    } catch (error) {
      Logger.error('Failed to delete connector', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
        connectorId: req.params.connectorId
      });
      next(error);
    }
  }
}

module.exports = ConnectorController;

