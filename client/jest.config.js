module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/*.test.ts',
    '!src/types/**/*.ts'
  ],
  coverageDirectory: 'coverage',
  verbose: true,
  
  // Add these settings for CommonJS compatibility
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      // Use CommonJS module format in tests
      useESM: false,
      isolatedModules: true
    }]
  },
  // Explicitly set moduleFileExtensions to prioritize .js
  moduleFileExtensions: ['js', 'ts', 'json', 'node'],
  // Allow importing JS files without extensions
  moduleDirectories: ['node_modules', 'src']
};