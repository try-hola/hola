/**
 * Mock implementation of the config manager
 */

// Create mock functions for configuration operations
const getSettings = jest.fn().mockResolvedValue({
  server_url: "http://localhost:3000",
  timeout: 60000,
  output_format: "table",
  color: "auto",
  log_level: "info",
  auto_update_check: true,
});

const setSettings = jest.fn().mockResolvedValue({});
const getServerContexts = jest.fn().mockResolvedValue({
  default: {
    name: "default",
    url: "https://example.org",
    providerOptions: {
      orbDomain: "example.org",
    },
    clientId: "mock-client-id",
  },
});

const getServerContext = jest.fn().mockResolvedValue({
  name: "test-server",
  url: "https://test.example.com",
  clientId: "test-client-id",
  type: "local",
  providerOptions: {
    orbDomain: "test.example.com",
  },
});

const saveServerContext = jest.fn().mockResolvedValue(undefined);
const removeServerContext = jest.fn().mockResolvedValue(undefined);
const getCurrentServerContext = jest.fn().mockResolvedValue("test-server");
const setCurrentServerContext = jest.fn().mockResolvedValue(true);
const resolveServerContext = jest.fn().mockResolvedValue({
  name: "default",
  url: "https://example.org",
  providerOptions: {
    orbDomain: "example.org",
  },
  clientId: "mock-client-id",
});

// Synchronous config methods
const get = jest.fn().mockImplementation((key, defaultValue) => {
  const config = {
    server_url: "http://localhost:3000",
    timeout: 60000,
    output_format: "table",
    color: "auto",
    log_level: "info",
    auto_update_check: true,
  };
  return config[key] !== undefined ? config[key] : defaultValue;
});

const set = jest.fn();
const getConfig = jest.fn().mockReturnValue({
  server_url: "http://localhost:3000",
  timeout: 60000,
  output_format: "table",
  color: "auto",
  log_level: "info",
  auto_update_check: true,
});

const loadConfig = jest.fn().mockResolvedValue({
  server_url: "http://localhost:3000",
  timeout: 60000,
  output_format: "table",
  color: "auto",
  log_level: "info",
  auto_update_check: true,
});

const saveConfig = jest.fn().mockResolvedValue({});
const init = jest.fn().mockResolvedValue({});

// Reset all mocks
const resetMocks = () => {
  getSettings.mockReset().mockResolvedValue({
    server_url: "http://localhost:3000",
    timeout: 60000,
    output_format: "table",
    color: "auto",
    log_level: "info",
    auto_update_check: true,
  });
  setSettings.mockReset().mockResolvedValue({});
  getServerContexts.mockReset().mockResolvedValue({
    default: {
      name: "default",
      url: "https://example.org",
      providerOptions: {
        orbDomain: "example.org",
      },
      clientId: "mock-client-id",
    },
  });
  getServerContext.mockReset().mockResolvedValue({
    name: "test-server",
    url: "https://test.example.com",
    clientId: "test-client-id",
    type: "local",
    providerOptions: {
      orbDomain: "test.example.com",
    },
  });
  saveServerContext.mockReset().mockResolvedValue(undefined);
  removeServerContext.mockReset().mockResolvedValue(undefined);
  getCurrentServerContext.mockReset().mockResolvedValue("test-server");
  setCurrentServerContext.mockReset().mockResolvedValue(true);
  resolveServerContext.mockReset().mockResolvedValue({
    name: "default",
    url: "https://example.org",
    providerOptions: {
      orbDomain: "example.org",
    },
    clientId: "mock-client-id",
  });
  get.mockReset().mockImplementation((key, defaultValue) => {
    const config = {
      server_url: "http://localhost:3000",
      timeout: 60000,
      output_format: "table",
      color: "auto",
      log_level: "info",
      auto_update_check: true,
    };
    return config[key] !== undefined ? config[key] : defaultValue;
  });
  set.mockReset();
  getConfig.mockReset().mockReturnValue({
    server_url: "http://localhost:3000",
    timeout: 60000,
    output_format: "table",
    color: "auto",
    log_level: "info",
    auto_update_check: true,
  });
  loadConfig.mockReset().mockResolvedValue({
    server_url: "http://localhost:3000",
    timeout: 60000,
    output_format: "table",
    color: "auto",
    log_level: "info",
    auto_update_check: true,
  });
  saveConfig.mockReset().mockResolvedValue({});
  init.mockReset().mockResolvedValue({});
};

// Export as CommonJS module
module.exports = {
  getSettings,
  setSettings,
  getServerContexts,
  getServerContext,
  saveServerContext,
  removeServerContext,
  getCurrentServerContext,
  setCurrentServerContext,
  resolveServerContext,
  get,
  set,
  getConfig,
  loadConfig,
  saveConfig,
  init,
  resetMocks,
};
