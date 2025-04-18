/**
 * Mock implementation of the API client
 */

// Create mock functions for API operations
const get = jest.fn().mockResolvedValue({
  success: true,
  data: {},
});

const post = jest.fn().mockResolvedValue({
  success: true,
  data: {},
});

const put = jest.fn().mockResolvedValue({
  success: true,
  data: {},
});

const del = jest.fn().mockResolvedValue({
  success: true,
  data: {},
});

// Alias delete to del since delete is a reserved word
const deleteMethod = del;

// Reset all mocks
const resetMocks = () => {
  get.mockReset().mockResolvedValue({
    success: true,
    data: {},
  });
  post.mockReset().mockResolvedValue({
    success: true,
    data: {},
  });
  put.mockReset().mockResolvedValue({
    success: true,
    data: {},
  });
  del.mockReset().mockResolvedValue({
    success: true,
    data: {},
  });
};

// Export as CommonJS module
module.exports = {
  get,
  post,
  put,
  delete: deleteMethod,
  del,
  resetMocks,
};
