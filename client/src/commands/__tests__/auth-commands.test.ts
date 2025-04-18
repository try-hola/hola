/**
 * Tests for auth commands
 */
const mockAuthManager = {
  authenticate: jest.fn().mockResolvedValue(true),
  logout: jest.fn().mockResolvedValue(true)
};
jest.mock('../../utils/auth-manager', () => mockAuthManager);

const mockConfigManager = {
  resolveServerContext: jest.fn().mockResolvedValue({
    name: 'test-server',
    url: 'https://test.orb.local',
    clientId: 'test-client-id',
    providerOptions: {
      orbDomain: 'test.orb.local'
    }
  }),
  getServerContexts: jest.fn().mockResolvedValue({
    'test-server': {
      name: 'test-server',
      url: 'https://test.orb.local'
    },
    'other-server': {
      name: 'other-server',
      url: 'https://other.orb.local'
    }
  })
};
jest.mock('../../utils/config-manager', () => mockConfigManager);

const mockOutputFormatter = {
  formatOutput: jest.fn()
};
jest.mock('../../utils/output-formatter', () => ({ outputFormatter: mockOutputFormatter }));

// Import login and logout handlers for testing
const { handler: loginHandler } = require('../auth/login');
const { handler: logoutHandler } = require('../auth/logout');

describe('Auth Commands', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  describe('login command', () => {
    it('should authenticate with the resolved server context', async () => {
      // Call the handler directly
      const options = {};
      await loginHandler(options);
      
      // Verify the authentication was called
      expect(mockConfigManager.resolveServerContext).toHaveBeenCalledWith(undefined);
      expect(mockAuthManager.authenticate).toHaveBeenCalledWith(expect.objectContaining({
        name: 'test-server'
      }));
      
      // Verify success message was shown
      expect(mockOutputFormatter.formatOutput).toHaveBeenCalledWith(
        'success',
        expect.stringContaining('Successfully authenticated')
      );
    });
    
    it('should use the specified server when --server option is provided', async () => {
      const options = { server: 'specific-server' };
      await loginHandler(options);
      
      // Verify the server context was resolved with the specified server
      expect(mockConfigManager.resolveServerContext).toHaveBeenCalledWith('specific-server');
    });
    
    it('should handle errors when no server context is found', async () => {
      // Mock the resolveServerContext to return null
      mockConfigManager.resolveServerContext.mockResolvedValueOnce(null);
      
      const options = {};
      await loginHandler(options);
      
      // Verify error message was shown
      expect(mockOutputFormatter.formatOutput).toHaveBeenCalledWith(
        'error',
        expect.stringContaining('No server context found')
      );
      
      // Verify authentication was not attempted
      expect(mockAuthManager.authenticate).not.toHaveBeenCalled();
    });
    
    it('should handle authentication errors', async () => {
      // Mock the authenticate method to throw an error
      mockAuthManager.authenticate.mockRejectedValueOnce(new Error('Authentication failed'));
      
      const options = {};
      await loginHandler(options);
      
      // Verify error message was shown
      expect(mockOutputFormatter.formatOutput).toHaveBeenCalledWith(
        'error',
        expect.stringContaining('Login failed')
      );
    });
  });
  
  describe('logout command', () => {
    it('should log out from the resolved server context', async () => {
      const options = {};
      await logoutHandler(options);
      
      // Verify the logout was called
      expect(mockConfigManager.resolveServerContext).toHaveBeenCalled();
      expect(mockAuthManager.logout).toHaveBeenCalledWith('test-server');
      
      // Verify success message was shown
      expect(mockOutputFormatter.formatOutput).toHaveBeenCalledWith(
        'success',
        expect.stringContaining('Logged out from server')
      );
    });
    
    it('should log out from all servers when --all option is provided', async () => {
      const options = { all: true };
      await logoutHandler(options);
      
      // Verify getServerContexts was called
      expect(mockConfigManager.getServerContexts).toHaveBeenCalled();
      
      // Verify logout was called for each server
      expect(mockAuthManager.logout).toHaveBeenCalledWith('test-server');
      expect(mockAuthManager.logout).toHaveBeenCalledWith('other-server');
      
      // Verify success message was shown
      expect(mockOutputFormatter.formatOutput).toHaveBeenCalledWith(
        'success',
        expect.stringContaining('Logged out from all')
      );
    });
    
    it('should handle errors when no server context is found', async () => {
      // Mock the resolveServerContext to return null
      mockConfigManager.resolveServerContext.mockResolvedValueOnce(null);
      
      const options = {};
      await logoutHandler(options);
      
      // Verify error message was shown
      expect(mockOutputFormatter.formatOutput).toHaveBeenCalledWith(
        'error',
        expect.stringContaining('No server context found')
      );
      
      // Verify logout was not attempted
      expect(mockAuthManager.logout).not.toHaveBeenCalled();
    });
    
    it('should handle logout errors', async () => {
      // Mock the logout method to throw an error
      mockAuthManager.logout.mockRejectedValueOnce(new Error('Logout failed'));
      
      const options = {};
      await logoutHandler(options);
      
      // Verify error message was shown
      expect(mockOutputFormatter.formatOutput).toHaveBeenCalledWith(
        'error',
        expect.stringContaining('Logout failed')
      );
    });
  });
});