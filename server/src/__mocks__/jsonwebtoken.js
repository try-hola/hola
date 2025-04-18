/**
 * Mock implementation of jsonwebtoken for Jest tests
 */
const jwt = {
  decode: jest.fn().mockReturnValue({
    header: { kid: "test-kid" },
  }),

  verify: jest.fn().mockReturnValue({
    sub: "test-user",
    name: "Test User",
    email: "test@example.com",
    roles: [],
  }),

  sign: jest.fn().mockReturnValue("mock.jwt.token"),
};

module.exports = jwt;
