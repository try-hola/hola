# Commander.js Implementation for Hola CLI

This document outlines the recommended approach for implementing the Hola CLI using Commander.js, a popular and lightweight solution for building command-line interfaces in Node.js.

## Why Commander.js?

Commander.js has been chosen for the Hola CLI for the following reasons:

1. **Simpler API**: More straightforward and intuitive for simpler command structures
2. **Lightweight**: Smaller dependency footprint than alternatives
3. **Widely Used**: Very popular with extensive community support
4. **TypeScript Support**: Good TypeScript definitions and compatibility
5. **Documentation Quality**: Clear, concise documentation with good examples

## Implementation Approach

### 1. Modular Command Structure

Organize commands in a directory structure that mirrors the command hierarchy:

```
client/src/
├── commands/
│   ├── app/
│   │   ├── deploy.ts
│   │   ├── list.ts
│   │   ├── info.ts
│   │   ├── upgrade.ts
│   │   └── index.ts   # Aggregates all app commands
│   ├── config/
│   │   ├── get.ts
│   │   ├── set.ts
│   │   ├── delete.ts
│   │   └── index.ts   # Aggregates all config commands
│   ├── settings/
│   │   ├── get.ts
│   │   ├── set.ts
│   │   └── index.ts   # Aggregates all settings commands
│   └── index.ts       # Central command registry
└── index.ts           # Entry point
```

### 2. Command Registration Pattern

Use a consistent pattern for defining commands:

```typescript
// Example: client/src/commands/app/list.ts
const { Command } = require("commander");

module.exports = function registerCommand(program) {
  return program
    .command("list")
    .description("List all deployed applications")
    .option(
      "-o, --output <format>",
      "output format (table, json, yaml)",
      "table"
    )
    .option("-s, --server <name>", "target server context")
    .action(async (options) => {
      // Command implementation
      // ...
    });
};
```

Then aggregate commands in their parent module:

```typescript
// Example: client/src/commands/app/index.ts
const { Command } = require("commander");

module.exports = function registerAppCommands(program) {
  const appCommand = new Command("app").description(
    "Application management commands"
  );

  // Register all app subcommands
  require("./list")(appCommand);
  require("./deploy")(appCommand);
  require("./info")(appCommand);
  require("./upgrade")(appCommand);
  // ... other app commands

  program.addCommand(appCommand);
  return program;
};
```

### 3. TypeScript Decorators (Optional Enhancement)

For a more elegant approach, consider using TypeScript decorators:

```typescript
// Example decorator approach
import { command, option, action } from "../decorators";

@command("list", "List all deployed applications")
class ListCommand {
  @option("-o, --output <format>", "output format (table, json, yaml)", "table")
  output: string = "table";

  @option("-s, --server <name>", "target server context")
  server?: string;

  @action()
  async execute() {
    // Command implementation
    // ...
  }
}

export default ListCommand;
```

This approach can reduce boilerplate and improve the consistency of command implementations.

## Error Handling

Implement a consistent error handling pattern:

```typescript
async function executeCommand(fn, options) {
  try {
    await fn(options);
  } catch (error) {
    if (error.isApiError) {
      // Handle API errors
      console.error(`API Error: ${error.message}`);
      if (error.code) {
        console.error(`Error code: ${error.code}`);
      }
    } else if (error.isNetworkError) {
      // Handle network errors
      console.error(`Network Error: ${error.message}`);
      console.error("Please check your connection and try again.");
    } else {
      // Handle unexpected errors
      console.error(`Error: ${error.message}`);
      if (options.debug) {
        console.error(error.stack);
      }
    }
    process.exit(1);
  }
}
```

## Output Formatting

Create a flexible output formatter:

```typescript
class OutputFormatter {
  format(data, options) {
    switch (options.output) {
      case "json":
        return this.formatJson(data);
      case "yaml":
        return this.formatYaml(data);
      case "table":
      default:
        return this.formatTable(data);
    }
  }

  formatTable(data) {
    // Table formatting logic
    // ...
  }

  formatJson(data) {
    return JSON.stringify(data, null, 2);
  }

  formatYaml(data) {
    // YAML formatting logic
    // ...
  }
}
```

## Testing Approach

Create unit tests for command modules using Jest:

```typescript
// Example: client/src/commands/app/__tests__/list.test.ts
const { Command } = require("commander");
const mockApiClient = jest.mock("../../../api/client");

describe("app list command", () => {
  let program;
  let registerCommand;

  beforeEach(() => {
    jest.clearAllMocks();
    program = new Command();
    registerCommand = require("../list");
    registerCommand(program);
  });

  it("should display a table of apps by default", async () => {
    // Setup
    mockApiClient.getApps.mockResolvedValue([
      { name: "app1", status: "running" },
      { name: "app2", status: "stopped" },
    ]);

    // Execute
    await program.parseAsync(["list"]);

    // Assert
    expect(mockApiClient.getApps).toHaveBeenCalled();
    // Additional assertions for output
    // ...
  });

  it("should output JSON when specified", async () => {
    // Setup
    mockApiClient.getApps.mockResolvedValue([
      { name: "app1", status: "running" },
    ]);

    // Execute
    await program.parseAsync(["list", "--output", "json"]);

    // Assert
    expect(mockApiClient.getApps).toHaveBeenCalled();
    // Assert JSON output
    // ...
  });
});
```

## Best Practices

1. **Avoid Deep Nesting**: Limit command nesting to 2-3 levels for usability
2. **Consistent Options**: Maintain consistency in option names and formats across commands
3. **Clear Help Text**: Provide detailed help text for all commands and options
4. **Exit Codes**: Use appropriate exit codes to indicate success/failure
5. **Validation First**: Validate all inputs before making API calls
6. **Progress Indicators**: Use spinners or progress bars for long-running operations
7. **Verbose Mode**: Implement a common `--verbose` flag for detailed output

By following these recommendations, the Hola CLI built with Commander.js will provide a robust, maintainable, and user-friendly command-line experience.
