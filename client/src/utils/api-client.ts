const axios = require('axios');
const configManager = require('./config-manager');
const serverProviderRegistry = require('./server-provider-registry');
const { handleError } = require('./error-handler');
const { ApiResponse } = require("../types");

/**
 * Generic API client for communicating with the Hola server
 * Generic by design to maintain flexibility across different server providers
 */
class ApiClient {
  /**
   * Create a new API client instance
   */
  constructor() {
    this.axiosInstance = null;
  }

  /**
   * Initialize the API client with a specific server context
   */
  async init(serverContext) {
    // Use provided context or resolve from config
    const context = serverContext || await configManager.resolveServerContext();
    
    if (!context) {
      throw new Error('No server context available. Use "hola server bootstrap" to set up a server.');
    }
    
    // Get provider for this context to handle any provider-specific configuration
    const provider = serverProviderRegistry.getProviderForContext(context);
    
    // Get access token
    let headers = {
      'Content-Type': 'application/json'
    };
    
    try {
      // Use the auth manager to get a valid access token
      const authManager = require('./auth-manager');
      const accessToken = await authManager.getAccessToken(context.name);
      headers['Authorization'] = `Bearer ${accessToken}`;
    } catch (error) {
      // Handle authentication error
      throw new Error('Authentication required. Please run: hola auth login');
    }
    
    // Create a new axios instance
    this.axiosInstance = axios.create({
      baseURL: `${context.url}/api`,
      timeout: context.timeout || 60000,
      headers
    });
    
    // Add provider-specific configuration if needed
    if (provider && typeof provider.configureApiClient === 'function') {
      await provider.configureApiClient(this.axiosInstance, context);
    }
    
    // Add response interceptor for error handling
    this.axiosInstance.interceptors.response.use(
      response => response,
      error => this.handleRequestError(error)
    );
    
    return this;
  }
  
  /**
   * Handle request errors
   */
  handleRequestError(error) {
    // Custom error handling logic
    if (error.response) {
      // Server responded with non-2xx status code
      const apiError = new Error(error.response.data.message || 'API Error');
      apiError.isApiError = true;
      apiError.code = error.response.data.code;
      apiError.status = error.response.status;
      apiError.details = error.response.data.details;
      return Promise.reject(apiError);
    } else if (error.request) {
      // Request was made but no response received
      const networkError = new Error('No response from server. Please check your connection.');
      networkError.isNetworkError = true;
      return Promise.reject(networkError);
    } else {
      // Error setting up the request
      return Promise.reject(error);
    }
  }

  /**
   * Make a GET request to the API
   */
  async get(path, params = {}, options = {}) {
    await this.ensureInitialized();
    try {
      const response = await this.axiosInstance.get(path, { params, ...options });
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Make a POST request to the API
   */
  async post(path, data = {}, options = {}) {
    await this.ensureInitialized();
    try {
      const response = await this.axiosInstance.post(path, data, options);
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Make a PUT request to the API
   */
  async put(path, data = {}, options = {}) {
    await this.ensureInitialized();
    try {
      const response = await this.axiosInstance.put(path, data, options);
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Make a DELETE request to the API
   */
  async delete(path, options = {}) {
    await this.ensureInitialized();
    try {
      const response = await this.axiosInstance.delete(path, options);
      return response.data;
    } catch (error) {
      throw error;
    }
  }
  
  /**
   * Create a connection for Server-Sent Events (SSE)
   */
  async createEventSource(path, onMessage, onError) {
    await this.ensureInitialized();
    
    // This is a placeholder for SSE implementation
    // The actual implementation would connect to the server for real-time updates
    
    return {
      close: () => {
        // Close the event source
      }
    };
  }
  
  /**
   * Ensure the client is initialized
   */
  async ensureInitialized() {
    if (!this.axiosInstance) {
      await this.init();
    }
  }
}

// Create a singleton instance
const apiClient = new ApiClient();

module.exports = apiClient;
