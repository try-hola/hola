// This file is required to load any necessary hooks before tests run
// For TypeScript support
require("ts-node/register/transpile-only");

// Add global config for tests
process.env.NODE_ENV = process.env.NODE_ENV || "test";

// Increase max listeners to prevent MaxListenersExceededWarning
// This is needed because we create multiple test servers in our tests
require("events").defaultMaxListeners = 20;
