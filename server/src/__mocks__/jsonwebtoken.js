/**
 * Mock implementation of jsonwebtoken for Jest tests
 */
const jwt = {
  decode: jest.fn().mockReturnValue({
    header: { kid: "test-kid" },
  }),

  verify: jest.fn().mockImplementation((token, secret, callback) => {
    if (token === "valid-token") {
      callback(null, { userId: "test-user" });
    } else {
      callback(new Error("Invalid token"));
    }
  }),

  sign: jest.fn().mockImplementation((payload, secret, options) => {
    return "mocked-jwt-token";
  }),
};

module.exports = jwt;
