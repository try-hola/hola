module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/__tests__/**/*.test.ts"],
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/*.d.ts",
    "!src/**/*.test.ts",
    "!src/types/**/*.ts",
  ],
  coverageDirectory: "coverage",
  verbose: true,

  // Add these settings for CommonJS compatibility
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: false,
        isolatedModules: true,
      },
    ],
  },
  moduleFileExtensions: ["js", "ts", "json", "node"],
  moduleDirectories: ["node_modules", "src"],

  // Add global teardown
  globalTeardown: "<rootDir>/src/test/jest-global-teardown.js",
};
