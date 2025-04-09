const axios = require("axios");
const { handleApiError } = require("./error-handler");
const configManager = require("./config-manager");

/**
 * API Client for communicating with the Hola server
 */
class ApiClient {
  // Axios client instance
  private client;
  /**
   * Create a new instance of the API client
   */
  constructor() {
    const config = configManager.getConfig();

    this.client = axios.create({
      baseURL: config.server_url,
      timeout: config.timeout,
      headers: {
        Authorization: `Bearer ${config.api_key}`,
        "Content-Type": "application/json",
      },
    });

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response.data,
      (error) => handleApiError(error)
    );
  }

  /**
   * Make a GET request to the API
   * @param {string} endpoint - API endpoint to call
   * @param {Object} params - Query parameters
   */
  async get(endpoint, params = {}) {
    try {
      return await this.client.get(endpoint, { params });
    } catch (error) {
      throw error; // Error will be handled by the interceptor
    }
  }

  /**
   * Make a POST request to the API
   * @param {string} endpoint - API endpoint to call
   * @param {Object} data - Request body
   */
  async post(endpoint, data = {}) {
    // To be implemented
    return { success: true, data: {} };
  }

  /**
   * Make a PUT request to the API
   * @param {string} endpoint - API endpoint to call
   * @param {Object} data - Request body
   */
  async put(endpoint, data = {}) {
    // To be implemented
    return { success: true, data: {} };
  }

  /**
   * Make a DELETE request to the API
   * @param {string} endpoint - API endpoint to call
   */
  async delete(endpoint) {
    // To be implemented
    return { success: true };
  }
}

module.exports = new ApiClient();
