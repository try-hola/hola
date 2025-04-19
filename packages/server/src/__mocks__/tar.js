// Mock implementation for tar module
const fs = require("fs-extra");
const path = require("path");

module.exports = {
  extract: jest.fn().mockImplementation(async (options) => {
    await fs.ensureDir(options.cwd);

    // Simulate different extracted content based on the test scenario
    if (
      options.file.includes("upgrade-test-app") &&
      options.file.includes("v2")
    ) {
      await fs.writeFile(
        path.join(options.cwd, "docker-compose.yml"),
        'version: "3"\nservices:\n  app:\n    image: nginx:alpine',
      );
    } else {
      await fs.writeFile(
        path.join(options.cwd, "docker-compose.yml"),
        'version: "3"\nservices:\n  app:\n    image: test-app-image',
      );
    }
    return Promise.resolve();
  }),
  create: jest.fn().mockResolvedValue(undefined),
};
