const express = require('express');
import { Application } from 'express';
const appsController = require('./controllers/apps');
const filesController = require('./controllers/files');

/**
 * Registers all API routes on the given Express application
 * 
 * @param app - The Express application instance
 */
export const registerRoutes = (app: Application): void => {
  // Root path for basic status check
  app.get('/', (req, res) => {
    res.json({ status: 'ok', version: process.env.npm_package_version || '1.0.0' });
  });

  // Application management routes
  app.post('/api/apps/deploy', appsController.deployApp); // Deploy a new application
  app.get('/api/apps', appsController.listApps); // List all deployed applications
  app.get('/api/apps/:appName/details', appsController.getAppDetails); // Get details about an application
  app.post('/api/apps/:appName/upgrade', appsController.upgradeApp); // Upgrade an existing application
  app.delete('/api/apps/:appName', appsController.removeApp); // Remove an application
  app.post('/api/apps/:appName/start', appsController.startApp); // Start an application
  app.post('/api/apps/:appName/stop', appsController.stopApp); // Stop an application

  // File management routes
  app.post('/api/apps/:appName/files', filesController.uploadFile, filesController.handleFileUpload); // Upload a file
  app.get('/api/apps/:appName/files', filesController.listFiles); // List files for an application
  app.get('/api/apps/:appName/files/:filePath(*)', filesController.getFile); // Get a specific file
  app.delete('/api/apps/:appName/files/:filePath(*)', filesController.deleteFile); // Delete a specific file
};

// Export using CommonJS syntax
module.exports = {
  registerRoutes
};
