// Mock implementation for ORAS utility
module.exports = {
  OrasRunner: jest.fn().mockImplementation(() => {
    return new (require("../../test/oras-test-adapter").OrasTestAdapter)();
  }),
};
