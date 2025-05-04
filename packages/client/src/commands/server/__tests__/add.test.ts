/**
 * Tests for server add command using Node.js test runner
 */
const { describe, it } = require("node:test");
const assert = require("node:assert");

// Helper function for tracking function calls
function trackCalls(fn) {
  const calls = [];
  const tracked = function (...args) {
    calls.push([...args]);
    return fn ? fn.apply(this, args) : undefined;
  };
  tracked.calls = calls;
  return tracked;
}

describe("Server Add Command (Node.js Test)", () => {
  it("should add a server context with all options provided via CLI", async () => {
    // Clear module cache to ensure fresh state
    Object.keys(require.cache).forEach((key) => {
      if (key.includes("/utils/") && !key.includes("node_modules")) {
        delete require.cache[key];
      }
      if (key.includes("/commands/server/")) {
        delete require.cache[key];
      }
    });

    // Mock config-manager
    const mockSaveServerContext = trackCalls(async () => undefined);
    const mockSetCurrentServerContext = trackCalls(async () => undefined);
    const mockGetServerContexts = trackCalls(async () => ({}));

    require.cache[require.resolve("../../../utils/config-manager")] = {
      exports: {
        saveServerContext: mockSaveServerContext,
        setCurrentServerContext: mockSetCurrentServerContext,
        getServerContexts: mockGetServerContexts,
      },
      id: require.resolve("../../../utils/config-manager"),
      filename: require.resolve("../../../utils/config-manager"),
      loaded: true,
      children: [],
      paths: [],
    };

    // Mock server-provider-registry
    const mockGetAvailableProviders = trackCalls(async () => [
      { type: "local", displayName: "Local Server" },
      { type: "remote", displayName: "Remote Server" },
    ]);

    const mockGetProvider = trackCalls((type) => {
      if (type === "local")
        return { type: "local", displayName: "Local Server" };
      if (type === "remote")
        return { type: "remote", displayName: "Remote Server" };
      return null;
    });

    require.cache[require.resolve("../../../utils/server-provider-registry")] =
      {
        exports: {
          getAvailableProviders: mockGetAvailableProviders,
          getProvider: mockGetProvider,
        },
        id: require.resolve("../../../utils/server-provider-registry"),
        filename: require.resolve("../../../utils/server-provider-registry"),
        loaded: true,
        children: [],
        paths: [],
      };

    // Mock output-formatter
    const mockFormatOutput = trackCalls(() => {});
    require.cache[require.resolve("../../../utils/output-formatter")] = {
      exports: {
        formatOutput: mockFormatOutput,
      },
      id: require.resolve("../../../utils/output-formatter"),
      filename: require.resolve("../../../utils/output-formatter"),
      loaded: true,
      children: [],
      paths: [],
    };

    // Mock inquirer
    const mockPrompt = trackCalls(async () => ({ setAsCurrent: true }));
    require.cache[require.resolve("inquirer")] = {
      exports: {
        prompt: mockPrompt,
      },
      id: require.resolve("inquirer"),
      filename: require.resolve("inquirer"),
      loaded: true,
      children: [],
      paths: [],
    };

    // Import the handler after mocking
    const { handler } = require("../add");

    // Call the handler with all options provided
    const options = {
      name: "test-server",
      url: "https://example.com",
      type: "local",
      clientId: "test-client-id",
    };

    const result = await handler(options);

    // Verify server context was saved correctly
    assert.strictEqual(
      mockSaveServerContext.calls.length,
      1,
      "saveServerContext should be called once",
    );
    assert.deepStrictEqual(
      mockSaveServerContext.calls[0][0],
      {
        name: "test-server",
        url: "https://example.com",
        type: "local",
        clientId: "test-client-id",
        providerOptions: {},
      },
      "Server context data should be correct",
    );

    // Verify current context was set
    assert.strictEqual(
      mockSetCurrentServerContext.calls.length,
      1,
      "setCurrentServerContext should be called once",
    );
    assert.strictEqual(
      mockSetCurrentServerContext.calls[0][0],
      "test-server",
      "Current server should be set correctly",
    );

    // Verify output was formatted correctly
    assert.strictEqual(
      mockFormatOutput.calls.length,
      2,
      "formatOutput should be called twice",
    );
    assert.deepStrictEqual(
      mockFormatOutput.calls[0],
      ["success", 'Server "test-server" added successfully'],
      "Success message should be correct",
    );
    assert.deepStrictEqual(
      mockFormatOutput.calls[1],
      ["info", 'Server "test-server" is now your current context'],
      "Current context message should be correct",
    );

    // Verify result structure
    assert.strictEqual(result.success, true, "Result should indicate success");
    assert.strictEqual(
      result.data.server.name,
      "test-server",
      "Server name in result should be correct",
    );
    assert.strictEqual(
      result.data.isCurrent,
      true,
      "Current flag should be correct",
    );
  });

  it("should prompt for missing options when not provided via CLI", async () => {
    // Clear module cache to ensure fresh state
    Object.keys(require.cache).forEach((key) => {
      if (key.includes("/utils/") && !key.includes("node_modules")) {
        delete require.cache[key];
      }
      if (key.includes("/commands/server/")) {
        delete require.cache[key];
      }
    });

    // Mock config-manager
    const mockSaveServerContext = trackCalls(async () => undefined);
    const mockSetCurrentServerContext = trackCalls(async () => undefined);
    const mockGetServerContexts = trackCalls(async () => ({}));

    require.cache[require.resolve("../../../utils/config-manager")] = {
      exports: {
        saveServerContext: mockSaveServerContext,
        setCurrentServerContext: mockSetCurrentServerContext,
        getServerContexts: mockGetServerContexts,
      },
      id: require.resolve("../../../utils/config-manager"),
      filename: require.resolve("../../../utils/config-manager"),
      loaded: true,
      children: [],
      paths: [],
    };

    // Mock server-provider-registry
    const mockGetAvailableProviders = trackCalls(async () => [
      { type: "local", displayName: "Local Server" },
      { type: "remote", displayName: "Remote Server" },
    ]);

    const mockGetProvider = trackCalls((type) => {
      if (type === "local")
        return { type: "local", displayName: "Local Server" };
      if (type === "remote")
        return { type: "remote", displayName: "Remote Server" };
      return null;
    });

    require.cache[require.resolve("../../../utils/server-provider-registry")] =
      {
        exports: {
          getAvailableProviders: mockGetAvailableProviders,
          getProvider: mockGetProvider,
        },
        id: require.resolve("../../../utils/server-provider-registry"),
        filename: require.resolve("../../../utils/server-provider-registry"),
        loaded: true,
        children: [],
        paths: [],
      };

    // Mock output-formatter
    const mockFormatOutput = trackCalls(() => {});
    require.cache[require.resolve("../../../utils/output-formatter")] = {
      exports: {
        formatOutput: mockFormatOutput,
      },
      id: require.resolve("../../../utils/output-formatter"),
      filename: require.resolve("../../../utils/output-formatter"),
      loaded: true,
      children: [],
      paths: [],
    };

    // Mock inquirer with sequential responses for different prompts
    const mockPrompt = trackCalls(async (questions) => {
      // Check the first question in the array to determine which prompt is being asked
      const questionName = questions[0]?.name;

      // Return appropriate response based on the question being asked
      switch (questionName) {
        case "serverName":
          return { serverName: "prompt-server" };
        case "serverUrl":
          return { serverUrl: "https://prompt-example.com" };
        case "providerType":
          return { providerType: "remote" };
        case "id": // This matches the field name in add.ts
          return { id: "prompt-client-id" };
        case "setAsCurrent":
          return { setAsCurrent: false };
        default:
          return {};
      }
    });

    require.cache[require.resolve("inquirer")] = {
      exports: {
        prompt: mockPrompt,
      },
      id: require.resolve("inquirer"),
      filename: require.resolve("inquirer"),
      loaded: true,
      children: [],
      paths: [],
    };

    // Import the handler after mocking
    const { handler } = require("../add");

    // Call the handler with empty options
    const options = {};

    const result = await handler(options);

    // Verify server context was saved correctly
    assert.strictEqual(
      mockSaveServerContext.calls.length,
      1,
      "saveServerContext should be called once",
    );
    assert.deepStrictEqual(
      mockSaveServerContext.calls[0][0],
      {
        name: "prompt-server",
        url: "https://prompt-example.com",
        type: "remote",
        clientId: "prompt-client-id",
        providerOptions: {},
      },
      "Server context data from prompts should be correct",
    );

    // Verify current context was NOT set (setAsCurrent was false)
    assert.strictEqual(
      mockSetCurrentServerContext.calls.length,
      0,
      "setCurrentServerContext should not be called",
    );

    // Verify output was formatted correctly
    assert.strictEqual(
      mockFormatOutput.calls.length,
      1,
      "formatOutput should be called once",
    );
    assert.deepStrictEqual(
      mockFormatOutput.calls[0],
      ["success", 'Server "prompt-server" added successfully'],
      "Success message should be correct",
    );

    // Verify result structure
    assert.strictEqual(result.success, true, "Result should indicate success");
    assert.strictEqual(
      result.data.server.name,
      "prompt-server",
      "Server name in result should be correct",
    );
    assert.strictEqual(
      result.data.isCurrent,
      false,
      "Current flag should be correct",
    );
  });

  it("should reject if server name already exists", async () => {
    // Clear module cache to ensure fresh state
    Object.keys(require.cache).forEach((key) => {
      if (key.includes("/utils/") && !key.includes("node_modules")) {
        delete require.cache[key];
      }
      if (key.includes("/commands/server/")) {
        delete require.cache[key];
      }
    });

    // Mock config-manager with existing server
    const mockSaveServerContext = trackCalls(async () => undefined);
    const mockSetCurrentServerContext = trackCalls(async () => undefined);
    const mockGetServerContexts = trackCalls(async () => ({
      "existing-server": {},
    }));

    require.cache[require.resolve("../../../utils/config-manager")] = {
      exports: {
        saveServerContext: mockSaveServerContext,
        setCurrentServerContext: mockSetCurrentServerContext,
        getServerContexts: mockGetServerContexts,
      },
      id: require.resolve("../../../utils/config-manager"),
      filename: require.resolve("../../../utils/config-manager"),
      loaded: true,
      children: [],
      paths: [],
    };

    // Mock server-provider-registry
    const mockGetAvailableProviders = trackCalls(async () => [
      { type: "local", displayName: "Local Server" },
      { type: "remote", displayName: "Remote Server" },
    ]);

    const mockGetProvider = trackCalls((type) => {
      if (type === "local")
        return { type: "local", displayName: "Local Server" };
      if (type === "remote")
        return { type: "remote", displayName: "Remote Server" };
      return null;
    });

    require.cache[require.resolve("../../../utils/server-provider-registry")] =
      {
        exports: {
          getAvailableProviders: mockGetAvailableProviders,
          getProvider: mockGetProvider,
        },
        id: require.resolve("../../../utils/server-provider-registry"),
        filename: require.resolve("../../../utils/server-provider-registry"),
        loaded: true,
        children: [],
        paths: [],
      };

    // Mock output-formatter
    const mockFormatOutput = trackCalls(() => {});
    require.cache[require.resolve("../../../utils/output-formatter")] = {
      exports: {
        formatOutput: mockFormatOutput,
      },
      id: require.resolve("../../../utils/output-formatter"),
      filename: require.resolve("../../../utils/output-formatter"),
      loaded: true,
      children: [],
      paths: [],
    };

    // Mock inquirer
    const mockPrompt = trackCalls(async () => ({ setAsCurrent: true }));
    require.cache[require.resolve("inquirer")] = {
      exports: {
        prompt: mockPrompt,
      },
      id: require.resolve("inquirer"),
      filename: require.resolve("inquirer"),
      loaded: true,
      children: [],
      paths: [],
    };

    // Import the handler after mocking
    const { handler } = require("../add");

    // Call the handler with name that already exists
    const options = {
      name: "existing-server",
      url: "https://example.com",
      type: "local",
      clientId: "test-client-id",
    };

    const result = await handler(options);

    // Verify server context was NOT saved
    assert.strictEqual(
      mockSaveServerContext.calls.length,
      0,
      "saveServerContext should not be called",
    );

    // Verify error message was displayed
    assert.strictEqual(
      mockFormatOutput.calls.length,
      1,
      "formatOutput should be called once",
    );
    assert.deepStrictEqual(
      mockFormatOutput.calls[0],
      ["error", 'Server context "existing-server" already exists'],
      "Error message should be correct",
    );

    // Verify result structure
    assert.strictEqual(result.success, false, "Result should indicate failure");
    assert.strictEqual(
      result.error.code,
      "DUPLICATE_NAME",
      "Error code should be correct",
    );
  });

  it("should reject if server URL is invalid", async () => {
    // Clear module cache to ensure fresh state
    Object.keys(require.cache).forEach((key) => {
      if (key.includes("/utils/") && !key.includes("node_modules")) {
        delete require.cache[key];
      }
      if (key.includes("/commands/server/")) {
        delete require.cache[key];
      }
    });

    // Mock config-manager
    const mockSaveServerContext = trackCalls(async () => undefined);
    const mockSetCurrentServerContext = trackCalls(async () => undefined);
    const mockGetServerContexts = trackCalls(async () => ({}));

    require.cache[require.resolve("../../../utils/config-manager")] = {
      exports: {
        saveServerContext: mockSaveServerContext,
        setCurrentServerContext: mockSetCurrentServerContext,
        getServerContexts: mockGetServerContexts,
      },
      id: require.resolve("../../../utils/config-manager"),
      filename: require.resolve("../../../utils/config-manager"),
      loaded: true,
      children: [],
      paths: [],
    };

    // Mock server-provider-registry
    const mockGetAvailableProviders = trackCalls(async () => [
      { type: "local", displayName: "Local Server" },
      { type: "remote", displayName: "Remote Server" },
    ]);

    const mockGetProvider = trackCalls((type) => {
      if (type === "local")
        return { type: "local", displayName: "Local Server" };
      if (type === "remote")
        return { type: "remote", displayName: "Remote Server" };
      return null;
    });

    require.cache[require.resolve("../../../utils/server-provider-registry")] =
      {
        exports: {
          getAvailableProviders: mockGetAvailableProviders,
          getProvider: mockGetProvider,
        },
        id: require.resolve("../../../utils/server-provider-registry"),
        filename: require.resolve("../../../utils/server-provider-registry"),
        loaded: true,
        children: [],
        paths: [],
      };

    // Mock output-formatter
    const mockFormatOutput = trackCalls(() => {});
    require.cache[require.resolve("../../../utils/output-formatter")] = {
      exports: {
        formatOutput: mockFormatOutput,
      },
      id: require.resolve("../../../utils/output-formatter"),
      filename: require.resolve("../../../utils/output-formatter"),
      loaded: true,
      children: [],
      paths: [],
    };

    // Mock inquirer
    const mockPrompt = trackCalls(async () => ({ setAsCurrent: true }));
    require.cache[require.resolve("inquirer")] = {
      exports: {
        prompt: mockPrompt,
      },
      id: require.resolve("inquirer"),
      filename: require.resolve("inquirer"),
      loaded: true,
      children: [],
      paths: [],
    };

    // Import the handler after mocking
    const { handler } = require("../add");

    // Call the handler with invalid URL
    const options = {
      name: "test-server",
      url: "invalid-url",
      type: "local",
      clientId: "test-client-id",
    };

    const result = await handler(options);

    // Verify server context was NOT saved
    assert.strictEqual(
      mockSaveServerContext.calls.length,
      0,
      "saveServerContext should not be called",
    );

    // Verify error message was displayed
    assert.strictEqual(
      mockFormatOutput.calls.length,
      1,
      "formatOutput should be called once",
    );
    assert.deepStrictEqual(
      mockFormatOutput.calls[0],
      ["error", "Invalid URL format"],
      "Error message should be correct",
    );

    // Verify result structure
    assert.strictEqual(result.success, false, "Result should indicate failure");
    assert.strictEqual(
      result.error.code,
      "INVALID_URL",
      "Error code should be correct",
    );
  });

  it("should handle no available providers", async () => {
    // Clear module cache to ensure fresh state
    Object.keys(require.cache).forEach((key) => {
      if (key.includes("/utils/") && !key.includes("node_modules")) {
        delete require.cache[key];
      }
      if (key.includes("/commands/server/")) {
        delete require.cache[key];
      }
    });

    // Mock config-manager
    const mockSaveServerContext = trackCalls(async () => undefined);
    const mockSetCurrentServerContext = trackCalls(async () => undefined);
    const mockGetServerContexts = trackCalls(async () => ({}));

    require.cache[require.resolve("../../../utils/config-manager")] = {
      exports: {
        saveServerContext: mockSaveServerContext,
        setCurrentServerContext: mockSetCurrentServerContext,
        getServerContexts: mockGetServerContexts,
      },
      id: require.resolve("../../../utils/config-manager"),
      filename: require.resolve("../../../utils/config-manager"),
      loaded: true,
      children: [],
      paths: [],
    };

    // Mock server-provider-registry with empty providers list
    const mockGetAvailableProviders = trackCalls(async () => []);
    const mockGetProvider = trackCalls(() => null);

    require.cache[require.resolve("../../../utils/server-provider-registry")] =
      {
        exports: {
          getAvailableProviders: mockGetAvailableProviders,
          getProvider: mockGetProvider,
        },
        id: require.resolve("../../../utils/server-provider-registry"),
        filename: require.resolve("../../../utils/server-provider-registry"),
        loaded: true,
        children: [],
        paths: [],
      };

    // Mock output-formatter
    const mockFormatOutput = trackCalls(() => {});
    require.cache[require.resolve("../../../utils/output-formatter")] = {
      exports: {
        formatOutput: mockFormatOutput,
      },
      id: require.resolve("../../../utils/output-formatter"),
      filename: require.resolve("../../../utils/output-formatter"),
      loaded: true,
      children: [],
      paths: [],
    };

    // Mock inquirer
    const mockPrompt = trackCalls(async () => ({}));
    require.cache[require.resolve("inquirer")] = {
      exports: {
        prompt: mockPrompt,
      },
      id: require.resolve("inquirer"),
      filename: require.resolve("inquirer"),
      loaded: true,
      children: [],
      paths: [],
    };

    // Import the handler after mocking
    const { handler } = require("../add");

    // Call the handler
    const options = {
      name: "test-server",
      url: "https://example.com",
      clientId: "test-client-id",
    };

    const result = await handler(options);

    // Verify server context was NOT saved
    assert.strictEqual(
      mockSaveServerContext.calls.length,
      0,
      "saveServerContext should not be called",
    );

    // Verify error message was displayed
    assert.strictEqual(
      mockFormatOutput.calls.length,
      1,
      "formatOutput should be called once",
    );
    assert.deepStrictEqual(
      mockFormatOutput.calls[0],
      ["error", "No server providers available"],
      "Error message should be correct",
    );

    // Verify result structure
    assert.strictEqual(result.success, false, "Result should indicate failure");
    assert.strictEqual(
      result.error.code,
      "NO_PROVIDERS",
      "Error code should be correct",
    );
  });

  it("should auto-select provider type if only one is available", async () => {
    // Clear module cache to ensure fresh state
    Object.keys(require.cache).forEach((key) => {
      if (key.includes("/utils/") && !key.includes("node_modules")) {
        delete require.cache[key];
      }
      if (key.includes("/commands/server/")) {
        delete require.cache[key];
      }
    });

    // Mock config-manager
    const mockSaveServerContext = trackCalls(async () => undefined);
    const mockSetCurrentServerContext = trackCalls(async () => undefined);
    const mockGetServerContexts = trackCalls(async () => ({}));

    require.cache[require.resolve("../../../utils/config-manager")] = {
      exports: {
        saveServerContext: mockSaveServerContext,
        setCurrentServerContext: mockSetCurrentServerContext,
        getServerContexts: mockGetServerContexts,
      },
      id: require.resolve("../../../utils/config-manager"),
      filename: require.resolve("../../../utils/config-manager"),
      loaded: true,
      children: [],
      paths: [],
    };

    // Mock server-provider-registry with single provider
    const mockGetAvailableProviders = trackCalls(async () => [
      { type: "local", displayName: "Local Server" },
    ]);

    const mockGetProvider = trackCalls((type) => {
      if (type === "local")
        return { type: "local", displayName: "Local Server" };
      return null;
    });

    require.cache[require.resolve("../../../utils/server-provider-registry")] =
      {
        exports: {
          getAvailableProviders: mockGetAvailableProviders,
          getProvider: mockGetProvider,
        },
        id: require.resolve("../../../utils/server-provider-registry"),
        filename: require.resolve("../../../utils/server-provider-registry"),
        loaded: true,
        children: [],
        paths: [],
      };

    // Mock output-formatter
    const mockFormatOutput = trackCalls(() => {});
    require.cache[require.resolve("../../../utils/output-formatter")] = {
      exports: {
        formatOutput: mockFormatOutput,
      },
      id: require.resolve("../../../utils/output-formatter"),
      filename: require.resolve("../../../utils/output-formatter"),
      loaded: true,
      children: [],
      paths: [],
    };

    // Mock inquirer
    const mockPrompt = trackCalls(async () => ({ setAsCurrent: false }));
    require.cache[require.resolve("inquirer")] = {
      exports: {
        prompt: mockPrompt,
      },
      id: require.resolve("inquirer"),
      filename: require.resolve("inquirer"),
      loaded: true,
      children: [],
      paths: [],
    };

    // Import the handler after mocking
    const { handler } = require("../add");

    // Call the handler without type option
    const options = {
      name: "test-server",
      url: "https://example.com",
      clientId: "test-client-id",
    };

    const result = await handler(options);

    // Verify server context was saved correctly with auto-selected type
    assert.strictEqual(
      mockSaveServerContext.calls.length,
      1,
      "saveServerContext should be called once",
    );
    assert.deepStrictEqual(
      mockSaveServerContext.calls[0][0],
      {
        name: "test-server",
        url: "https://example.com",
        type: "local",
        clientId: "test-client-id",
        providerOptions: {},
      },
      "Server context data should be correct with auto-selected type",
    );

    // Verify current context was NOT set
    assert.strictEqual(
      mockSetCurrentServerContext.calls.length,
      0,
      "setCurrentServerContext should not be called",
    );

    // Verify output was formatted correctly
    assert.strictEqual(
      mockFormatOutput.calls.length,
      1,
      "formatOutput should be called once",
    );
    assert.deepStrictEqual(
      mockFormatOutput.calls[0],
      ["success", 'Server "test-server" added successfully'],
      "Success message should be correct",
    );

    // Verify result structure
    assert.strictEqual(result.success, true, "Result should indicate success");
    assert.strictEqual(
      result.data.server.name,
      "test-server",
      "Server name in result should be correct",
    );
    assert.strictEqual(
      result.data.server.type,
      "local",
      "Server type should be auto-selected",
    );
    assert.strictEqual(
      result.data.isCurrent,
      false,
      "Current flag should be correct",
    );
  });

  it("should reject if provider type is invalid", async () => {
    const { handler } = require("../add");

    // Set up mocks
    const mockSaveServerContext = trackCalls(async () => undefined);
    const mockGetServerContexts = trackCalls(async () => ({}));

    require.cache[require.resolve("../../../utils/config-manager")] = {
      exports: {
        saveServerContext: mockSaveServerContext,
        getServerContexts: mockGetServerContexts,
      },
      id: require.resolve("../../../utils/config-manager"),
      filename: require.resolve("../../../utils/config-manager"),
      loaded: true,
      children: [],
      paths: [],
    };

    const mockGetAvailableProviders = trackCalls(async () => [
      { type: "local", displayName: "Local Server" },
    ]);

    const mockGetProvider = trackCalls((type) => {
      if (type === "local")
        return { type: "local", displayName: "Local Server" };
      return null;
    });

    require.cache[require.resolve("../../../utils/server-provider-registry")] =
      {
        exports: {
          getAvailableProviders: mockGetAvailableProviders,
          getProvider: mockGetProvider,
        },
        id: require.resolve("../../../utils/server-provider-registry"),
        filename: require.resolve("../../../utils/server-provider-registry"),
        loaded: true,
        children: [],
        paths: [],
      };

    const mockFormatOutput = trackCalls(() => {});
    require.cache[require.resolve("../../../utils/output-formatter")] = {
      exports: { formatOutput: mockFormatOutput },
      id: require.resolve("../../../utils/output-formatter"),
      filename: require.resolve("../../../utils/output-formatter"),
      loaded: true,
      children: [],
      paths: [],
    };

    const options = {
      name: "test-server",
      url: "https://example.com",
      type: "invalid-type",
    };

    const result = await handler(options);

    assert.strictEqual(
      mockSaveServerContext.calls.length,
      0,
      "saveServerContext should not be called",
    );
    assert.strictEqual(result.success, false, "Result should indicate failure");
    assert.strictEqual(
      result.error.code,
      "INVALID_PROVIDER",
      "Should have correct error code",
    );
    assert.strictEqual(
      result.error.message,
      'Unknown provider type "invalid-type". Available types: local',
      "Should have descriptive error message",
    );
  });

  it("should handle errors gracefully", async () => {
    // First clear all relevant modules from cache
    const modulesToClear = [
      "../add",
      "../../../utils/config-manager",
      "../../../utils/server-provider-registry",
      "../../../utils/output-formatter",
      "inquirer",
    ];

    modulesToClear.forEach((modulePath) => {
      const fullPath = require.resolve(modulePath);
      delete require.cache[fullPath];
    });

    // Set up mocks before requiring the handler
    const mockSaveServerContext = trackCalls(async () => {
      throw new Error("Failed to save server context");
    });
    const mockGetServerContexts = trackCalls(async () => ({}));
    const mockSetCurrentServerContext = trackCalls(async () => undefined);

    require.cache[require.resolve("../../../utils/config-manager")] = {
      exports: {
        saveServerContext: mockSaveServerContext,
        getServerContexts: mockGetServerContexts,
        setCurrentServerContext: mockSetCurrentServerContext,
      },
      id: require.resolve("../../../utils/config-manager"),
      filename: require.resolve("../../../utils/config-manager"),
      loaded: true,
      children: [],
      paths: [],
    };

    const mockGetAvailableProviders = trackCalls(async () => [
      { type: "local", displayName: "Local Server" },
    ]);

    const mockGetProvider = trackCalls((type) => {
      if (type === "local")
        return { type: "local", displayName: "Local Server" };
      return null;
    });

    require.cache[require.resolve("../../../utils/server-provider-registry")] =
      {
        exports: {
          getAvailableProviders: mockGetAvailableProviders,
          getProvider: mockGetProvider,
        },
        id: require.resolve("../../../utils/server-provider-registry"),
        filename: require.resolve("../../../utils/server-provider-registry"),
        loaded: true,
        children: [],
        paths: [],
      };

    const mockFormatOutput = trackCalls(() => {});
    require.cache[require.resolve("../../../utils/output-formatter")] = {
      exports: { formatOutput: mockFormatOutput },
      id: require.resolve("../../../utils/output-formatter"),
      filename: require.resolve("../../../utils/output-formatter"),
      loaded: true,
      children: [],
      paths: [],
    };

    const mockPrompt = trackCalls(async (questions) => {
      const questionName = questions[0]?.name;
      if (questionName === "setAsCurrent") {
        return { setAsCurrent: false };
      }
      return {};
    });

    require.cache[require.resolve("inquirer")] = {
      exports: { prompt: mockPrompt },
      id: require.resolve("inquirer"),
      filename: require.resolve("inquirer"),
      loaded: true,
      children: [],
      paths: [],
    };

    // Now require the handler after all mocks are set up
    const { handler } = require("../add");

    const options = {
      name: "test-server",
      url: "https://example.com",
      type: "local",
      clientId: "test-client",
    };

    const result = await handler(options);

    // Validate that provider validation happens before the error
    assert.strictEqual(
      mockGetProvider.calls.length,
      1,
      "getProvider should be called once",
    );
    assert.deepStrictEqual(
      mockGetProvider.calls[0],
      ["local"],
      "getProvider should be called with correct type",
    );

    // Validate that save was attempted and failed
    assert.strictEqual(
      mockSaveServerContext.calls.length,
      1,
      "saveServerContext should be called once",
    );
    assert.deepStrictEqual(
      mockSaveServerContext.calls[0][0],
      {
        name: "test-server",
        url: "https://example.com",
        type: "local",
        clientId: "test-client",
        providerOptions: {},
      },
      "saveServerContext should be called with correct data",
    );

    // Validate error handling
    assert.strictEqual(result.success, false, "Result should indicate failure");
    assert.strictEqual(
      result.error.code,
      "ADD_SERVER_ERROR",
      "Should have correct error code",
    );
    assert.strictEqual(
      result.error.message,
      "Failed to add server: Failed to save server context",
      "Should have descriptive error message",
    );

    // Validate error output
    assert.strictEqual(
      mockFormatOutput.calls.length,
      1,
      "formatOutput should be called once",
    );
    assert.deepStrictEqual(
      mockFormatOutput.calls[0],
      ["error", "Failed to add server: Failed to save server context"],
      "Error message should be displayed",
    );
  });
});
