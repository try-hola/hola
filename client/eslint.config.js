// @ts-check

const tseslint = require("@typescript-eslint/eslint-plugin");
const tsParser = require("@typescript-eslint/parser");
const eslint = require("@eslint/js");

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
        project: "./tsconfig.json", // Point to your tsconfig for type-aware rules
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      // Apply recommended TypeScript rules
      ...tseslint.configs["recommended-type-checked"].rules,
      // Add or override specific rules here if needed
      // e.g., '@typescript-eslint/no-unused-vars': 'warn',
    },
  },

  // Configuration for JavaScript files (if any, e.g., config files)
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "commonjs", // Assuming JS files are also CommonJS
    },
    // Add JS-specific rules if necessary
  },

  // General settings for all files (can refine if needed)
  {
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
  },
];
