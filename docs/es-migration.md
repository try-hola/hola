# Migrating Hola Monorepo to ES Modules with TypeScript

This document provides a comprehensive, step-by-step guide for migrating the Hola monorepo from CommonJS modules to ES modules (ESM) while maintaining TypeScript compatibility and best practices for Node.js development.

---

## Why Migrate?

- **TypeScript Ecosystem:** ESM is the standard for modern TypeScript and Node.js projects.
- **Tooling:** Improved compatibility with modern tools, bundlers, and IDEs.
- **Maintainability:** Cleaner syntax and better static analysis.
- **Future-Proofing:** Node.js and TypeScript are moving toward ESM as the default.

---

## Migration Plan

### 1. Update TypeScript Configuration

- In each package (`client`, `server`, shared):
  - Set `module` to `"ESNext"` or `"NodeNext"`.
  - Set `moduleResolution` to `"NodeNext"`.
  - Ensure `esModuleInterop` is `true`.

```jsonc
// Example tsconfig.json changes
{
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "NodeNext",
    "target": "ES2020",
    "esModuleInterop": true,
    "outDir": "dist",
    "declaration": true,
    "sourceMap": true,
    "strict": true,
  },
}
```

---

### 2. Update `package.json` for ESM

- Add `"type": "module"` to each package's `package.json`.

```json
{
  "type": "module"
}
```

---

### 3. Refactor All Imports/Exports

- **Replace** `require`/`module.exports` with `import`/`export` syntax.
- **Use** `.js` extensions in all import paths (required by Node.js ESM).
- **Example:**

```typescript
// Before (CommonJS)
const { Command } = require("commander");
module.exports = { createProgram, registerCommands };

// After (ESM)
import { Command } from "commander";
export { createProgram, registerCommands };
```

---

### 4. Update CLI Entrypoints

- Use ESM syntax in CLI entrypoints.
- If using a shebang, keep `#!/usr/bin/env node` at the top.
- Use `ts-node-esm` or compile to JS before running.

---

### 5. Update Test and Build Tooling

- **Jest:** Enable ESM support (`extensionsToTreatAsEsm: [".ts"]`).
- **ts-node:** Use `ts-node-esm` or `ts-node --loader ts-node/esm`.
- **Build:** Ensure `tsc` emits ESM.

---

### 6. Update Shared Types and Workspace References

- Use ESM syntax for all shared types/interfaces.
- Update all cross-package imports to use ESM and `.js` extensions.

---

### 7. Linting and Formatting

- Update ESLint and Prettier configs for ESM support.
- Use `@typescript-eslint/parser` with ESM enabled.

---

### 8. Documentation and Developer Workflow

- Update code samples and docs to use ESM syntax.
- Add migration notes and troubleshooting tips.

---

## Example Migration

**Before:**

```typescript
// filepath: /workspaces/hola/packages/client/src/commands/index.ts
const { Command } = require("commander");
function registerCommands(program) { ... }
module.exports = { createProgram, registerCommands };
```

**After:**

```typescript
// filepath: /workspaces/hola/packages/client/src/commands/index.ts
import { Command } from "commander";
import app from "./app/index.js";
import config from "./config/index.js";
// ...other imports...

export function registerCommands(program) {
  app(program);
  config(program);
  // ...other commands...
  return program;
}

export function createProgram() {
  const program = new Command();
  program
    .name("hola")
    .description("Hola CLI for application deployment and management")
    .version("0.1.0");
  registerCommands(program);
  // ...options...
  return program;
}
```

---

## Testing the Migration

- Run `yarn build` in each package.
- Run `yarn dev` and all CLI commands.
- Run `yarn test` for all packages.
- Perform end-to-end tests.

---

## Rollback Plan

- Keep migration in a feature branch.
- Use CI to validate changes.
- Rollback by reverting to the previous branch if needed.

---

## References

- [TypeScript: Migrating from CommonJS to ES Modules](https://www.typescriptlang.org/docs/handbook/esm-node.html)
- [Node.js ESM Docs](https://nodejs.org/api/esm.html)
- [Jest ESM Support](https://jestjs.io/docs/ecmascript-modules)

---

## Migration Checklist

- [ ] Update all `tsconfig.json` files for ESM.
- [ ] Add `"type": "module"` to all `package.json`.
- [ ] Refactor all imports/exports to ESM syntax.
- [ ] Update CLI entrypoints and scripts.
- [ ] Update test/build tooling for ESM.
- [ ] Update shared types and workspace references.
- [ ] Update documentation and onboarding.
- [ ] Test thoroughly across all packages.

---

**By following this plan, the Hola monorepo will be fully migrated to TypeScript-native ES modules, unlocking better tooling, maintainability, and future compatibility.**
