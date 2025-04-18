// @ts-check

/**
 * Root ESLint configuration using the new flat config format
 * @type {import('eslint').Linter.FlatConfig[]}
 */
// const somePlugin = require('eslint-plugin-some-plugin'); // Example if you have imports

module.exports = [
  {
    // Global ignores for the entire workspace
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/.git/**",
    ],
  },
  // Shared base configuration for all files
  {
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "module",
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: "module",
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
    // plugins: {
    //   somePlugin // Example
    // },
    rules: {
      // ... your rules ...
    }
  }
];
