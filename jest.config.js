// filepath: /workspaces/hola/jest.config.js
module.exports = {
  // Automatically clear mock calls and instances between every test
  clearMocks: true,

  // Indicates whether the coverage information should be collected while executing the test
  collectCoverage: true,

  // The directory where Jest should output its coverage files
  coverageDirectory: "coverage",

  // An array of glob patterns indicating a set of files for which coverage information should be collected
  collectCoverageFrom: [
    "packages/*/src/**/*.{js,ts}",
    "!packages/*/src/**/*.d.ts",
    "!packages/*/src/**/__tests__/**",
    "!packages/*/src/**/__mocks__/**",
  ],

  // A list of reporter names that Jest uses when writing coverage reports
  coverageReporters: ["json", "text", "lcov", "clover"],

  // Use this configuration option to add custom reporters to Jest
  reporters: ["default"],

  // The test environment that will be used for testing
  testEnvironment: "node",

  // The glob patterns Jest uses to detect test files
  testMatch: [
    "**/__tests__/**/*.test.[jt]s?(x)",
    "**/?(*.)+(spec|test).[tj]s?(x)",
  ],

  // An array of regexp pattern strings that are matched against all test paths before executing the test
  testPathIgnorePatterns: ["/node_modules/", "/dist/"],

  // Indicates whether each individual test should be reported during the run
  verbose: true,

  // Use the projects configuration to run tests for each workspace
  projects: [
    "<rootDir>/packages/client/jest.config.js",
    "<rootDir>/packages/server/jest.config.js",
    // Add paths to other workspace jest configs if you have more
  ],

  // Add transform for TypeScript if not handled by project configs (often needed at root too)
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        // Use CommonJS module format in tests
        useESM: false,
        isolatedModules: true,
      },
    ],
  },
  // Explicitly set moduleFileExtensions to prioritize .js for CommonJS
  moduleFileExtensions: ["js", "ts", "json", "node"],
};
