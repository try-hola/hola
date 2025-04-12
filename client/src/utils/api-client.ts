const axios = require("axios");
const { handleApiError } = require("./error-handler");
const configManager = require("./config-manager");
const { ApiResponse } = require("../types");

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
   * @returns {Promise<ApiResponse<any>>}
   */
  async get(endpoint: string, params: Record<string, any> = {}): Promise<typeof ApiResponse> {
    try {
      const response = await this.client.get(endpoint, { params });
      return { success: true, data: response };
    } catch (error) {
      return {
        success: false,
        error: {
          code: error.code,
          message: error.message,
          details: error.response?.data,
        },
      };
    }
  }

  /**
   * Make a POST request to the API
   * @param {string} endpoint - API endpoint to call
   * @param {Object} data - Request body
   * @returns {Promise<ApiResponse<any>>}
   */
  async post(endpoint: string, data: Record<string, any> = {}): Promise<typeof ApiResponse> {
    try {
      const response = await this.client.post(endpoint, data);
      return { success: true, data: response };
    } catch (error) {
      return {
        success: false,
        error: {
          code: error.code,
          message: error.message,
          details: error.response?.data,
        },
      };
    }
  }

  /**
   * Make a PUT request to the API
   * @param {string} endpoint - API endpoint to call
   * @param {Object} data - Request body
   * @returns {Promise<ApiResponse<any>>}
   */
  async put(endpoint: string, data: Record<string, any> = {}): Promise<typeof ApiResponse> {
    try {
      const response = await this.client.put(endpoint, data);
      return { success: true, data: response };
    } catch (error) {
      return {
        success: false,
        error: {
          code: error.code,
          message: error.message,
          details: error.response?.data,
        },
      };
    }
  }

  /**
   * Make a DELETE request to the API
   * @param {string} endpoint - API endpoint to call
   * @returns {Promise<ApiResponse<any>>}
   */
  async delete(endpoint: string): Promise<typeof ApiResponse> {
    try {
      const response = await this.client.delete(endpoint);
      return { success: true, data: response };
    } catch (error) {
      return {
        success: false,
        error: {
          code: error.code,
          message: error.message,
          details: error.response?.data,
        },
      };
    }
  }
}

module.exports = new ApiClient();
