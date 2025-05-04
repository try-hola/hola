// @ts-check

const tseslint = require("@typescript-eslint/eslint-plugin");
const tsParser = require("@typescript-eslint/parser");
const eslint = require("@eslint/js");
const globals = require("globals"); // Import globals

/**
 * ESLint configuration using the new flat config format
 * @type {import('eslint').Linter.FlatConfig[]}
 */
module.exports = [
  {
    // Global ignores for the entire workspace
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/.git/**",
      "eslint.config.js", // Ignore the config file itself
    ],
  },

  // Apply ESLint recommended rules globally
  eslint.configs.recommended,

  // Configuration specifically for TypeScript files
  {
    files: ["**/*.ts"], // Target only TypeScript files
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: "commonjs", // Use commonjs for Node.js/TypeScript server
        // Use project service for type-aware linting
        project: true, // Automatically find tsconfig.json
        tsconfigRootDir: __dirname, // Set the root directory for tsconfig discovery
      },
      globals: {
        // Add Node.js globals
        ...globals.node,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      // Apply recommended TypeScript rules
      ...tseslint.configs["recommended-type-checked"].rules,
      // Disable the rule conflicting with CommonJS requirement
      "@typescript-eslint/no-require-imports": "off",
      // Add or override specific rules here if needed
      // e.g., '@typescript-eslint/no-unused-vars': 'warn',
    },
  },

  // Configuration for JavaScript files (including mocks)
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "commonjs", // Assuming JS files are also CommonJS
      globals: {
        // Add Node.js globals
        ...globals.node,
      },
    },
    // Add JS-specific rules if necessary
  },

  // Configuration specifically for TypeScript Test files
  {
    files: ["**/*.test.ts", "**/__tests__/**/*.ts"],
    languageOptions: {
      globals: {
        // Add Node.js test globals
        ...globals.node,
      },
    },
    // Rules for test files
    rules: {
      // Disable TypeScript safety rules in test files to facilitate testing
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },

  // Special configuration for mocks
  {
    files: ["**/__mocks__/**/*.js"],
    rules: {
      // Disable no-unused-vars for mock files since parameters are often defined but not used
      "no-unused-vars": "off",
    },
  },

  // General settings for all files (can refine if needed)
  {
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
  },
];
