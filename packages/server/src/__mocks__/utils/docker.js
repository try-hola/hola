// Mock implementation for Docker utility
module.exports = {
  DockerRunner: jest.fn().mockImplementation(() => {
    return new (require("../../test/docker-test-adapter").DockerTestAdapter)();
  }),
};
