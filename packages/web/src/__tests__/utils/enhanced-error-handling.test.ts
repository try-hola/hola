// Test suite for Phase 3.2 Enhanced Error Handling features
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { 
  ErrorType, 
  createEnhancedError, 
  classifyError, 
  calculateRetryDelay,
  enhancedFetch,
  NetworkStatus
} from '../../utils/error-enhanced';

// Mock fetch with proper typing
const mockFetch = vi.fn();
const originalFetch = global.fetch;

describe('Enhanced Error Handling - Phase 3.2', () => {
  beforeEach(() => {
    // Mock global fetch
    global.fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockClear();

    // Ensure navigator.onLine is true without replacing the entire navigator
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: true,
    });

    // Spy on window event listeners instead of overwriting window
    vi.spyOn(window, 'addEventListener').mockImplementation(vi.fn() as unknown as typeof window.addEventListener);
    vi.spyOn(window, 'removeEventListener').mockImplementation(vi.fn() as unknown as typeof window.removeEventListener);
  });

  afterEach(() => {
    // Restore global fetch
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('Error Classification', () => {
    it('should classify network errors correctly', () => {
      const error = new Error('Failed to fetch');
      const type = classifyError(undefined, error);
      expect(type).toBe(ErrorType.NETWORK);
    });

    it('should classify server errors correctly', () => {
      const response = { status: 500 } as Response;
      const type = classifyError(response);
      expect(type).toBe(ErrorType.SERVER);
    });

    it('should classify client errors correctly', () => {
      const response = { status: 404 } as Response;
      const type = classifyError(response);
      expect(type).toBe(ErrorType.CLIENT);
    });

    it('should classify validation errors correctly', () => {
      const response = { status: 400 } as Response;
      const type = classifyError(response);
      expect(type).toBe(ErrorType.VALIDATION);
    });

    it('should classify permission errors correctly', () => {
      const response = { status: 401 } as Response;
      const type = classifyError(response);
      expect(type).toBe(ErrorType.PERMISSION);
    });

    it('should classify rate limit errors correctly', () => {
      const response = { status: 429 } as Response;
      const type = classifyError(response);
      expect(type).toBe(ErrorType.RATE_LIMIT);
    });

    it('should classify offline errors when navigator is offline', () => {
      // Temporarily set navigator offline for this test
      Object.defineProperty(window.navigator, 'onLine', {
        configurable: true,
        value: false,
      });

      const type = classifyError();
      expect(type).toBe(ErrorType.OFFLINE);
      // Restore is handled in afterEach via defineProperty in beforeEach
    });
  });

  describe('Enhanced Error Creation', () => {
    it('should create enhanced error with user-friendly message', () => {
      const originalError = new Error('Technical error message');
      const enhancedError = createEnhancedError(originalError);
      
      expect(enhancedError.type).toBeDefined();
      expect(enhancedError.userMessage).toBeDefined();
      expect(enhancedError.technicalMessage).toBe('Technical error message');
      expect(enhancedError.timestamp).toBeTypeOf('number');
      expect(enhancedError.retryable).toBeTypeOf('boolean');
    });

    it('should include suggestions for recoverable errors', () => {
      const originalError = new Error('Network connection failed');
      const enhancedError = createEnhancedError(originalError);

      expect(enhancedError.suggestion).toBeDefined();
      expect(enhancedError.suggestion).toContain('try again');
    });
  });

  describe('Retry Logic', () => {
    it('should calculate exponential backoff delays correctly', () => {
      const config = {
        baseDelay: 1000,
        maxDelay: 10000,
        multiplier: 2,
        jitter: false,
        maxAttempts: 3,
      };

      const delay1 = calculateRetryDelay(1, config);
      const delay2 = calculateRetryDelay(2, config);
      const delay3 = calculateRetryDelay(3, config);

      expect(delay1).toBe(1000); // base delay
      expect(delay2).toBe(2000); // base * multiplier^1
      expect(delay3).toBe(4000); // base * multiplier^2
    });

    it('should respect maximum delay cap', () => {
      const config = {
        baseDelay: 1000,
        maxDelay: 3000,
        multiplier: 4,
        jitter: false,
        maxAttempts: 5,
      };

      const delay4 = calculateRetryDelay(4, config);
      expect(delay4).toBeLessThanOrEqual(3000);
    });

    it('should add jitter when enabled', () => {
      const config = {
        baseDelay: 1000,
        maxDelay: 10000,
        multiplier: 2,
        jitter: true,
        maxAttempts: 3,
      };

      const delays = Array.from({ length: 10 }, () => calculateRetryDelay(2, config));
      
      // With jitter, delays should vary
      const uniqueDelays = new Set(delays);
      expect(uniqueDelays.size).toBeGreaterThan(1);
      
      // All delays should be within reasonable bounds
      delays.forEach(delay => {
        expect(delay).toBeGreaterThanOrEqual(1500); // 2000 - 25%
        expect(delay).toBeLessThanOrEqual(2500);    // 2000 + 25%
      });
    });
  });

  describe('Enhanced Fetch', () => {
    it('should successfully fetch when response is ok', async () => {
      const mockResponse = {
        ok: true,
        json: () => Promise.resolve({ data: 'test' })
      };
      mockFetch.mockResolvedValueOnce(mockResponse);

      const response = await enhancedFetch('https://example.com/api');
      expect(response.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should throw enhanced error for server errors', async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({ 
          error: { message: 'Server is down' } 
        })
      } as Response;
      mockFetch.mockResolvedValue(mockResponse);

      try {
        // Disable retries for this test to avoid timeout
        await enhancedFetch('https://example.com/api', {}, { maxAttempts: 1 });
        expect.fail('Should have thrown an error');
      } catch (error: unknown) {
        // Type assertion based on our EnhancedError interface
        const enhancedError = error as Error & { 
          type: ErrorType; 
          statusCode?: number; 
        };
        expect(enhancedError.type).toBe(ErrorType.SERVER);
        expect(enhancedError.statusCode).toBe(500);
      }
    });

    it('should retry retryable errors', async () => {
      // Mock a network error that should be retryable
      const networkError = new Error('Network error');
      networkError.name = 'TypeError';
      
      // First call fails with network error, second succeeds
      mockFetch
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: 'success' })
        });

      const response = await enhancedFetch('https://example.com/api', {}, {
        maxAttempts: 2,
        baseDelay: 10, // Very short delay for testing
        maxDelay: 20,
        multiplier: 1,
        jitter: false
      });

      expect(response.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should not retry non-retryable errors', async () => {
      const mockResponse = {
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: () => Promise.resolve({ 
          error: { message: 'Invalid request' } 
        })
      };
      mockFetch.mockResolvedValueOnce(mockResponse);

      await expect(enhancedFetch('https://example.com/api')).rejects.toThrow();
      expect(mockFetch).toHaveBeenCalledTimes(1); // No retry for client errors
    });
  });

  describe('Network Status', () => {
    it('should detect online status', () => {
      Object.defineProperty(window.navigator, 'onLine', {
        configurable: true,
        value: true,
      });
      expect(NetworkStatus.isOnline()).toBe(true);
    });

    it('should detect offline status', () => {
      Object.defineProperty(window.navigator, 'onLine', {
        configurable: true,
        value: false,
      });
      expect(NetworkStatus.isOnline()).toBe(false);
      // Restore is handled by beforeEach
    });

    it('should allow adding and removing listeners', () => {
      const mockCallback = vi.fn();
  const mockAddEventListener = vi.spyOn(window, 'addEventListener').mockImplementation(vi.fn() as unknown as typeof window.addEventListener);
  const mockRemoveEventListener = vi.spyOn(window, 'removeEventListener').mockImplementation(vi.fn() as unknown as typeof window.removeEventListener);
      
      const cleanup = NetworkStatus.addListener(mockCallback);
      
      // Cleanup should be a function
      expect(typeof cleanup).toBe('function');
      
      // Should have added event listeners
  expect(mockAddEventListener).toHaveBeenCalledWith('online', expect.any(Function));
  expect(mockAddEventListener).toHaveBeenCalledWith('offline', expect.any(Function));
  expect(mockRemoveEventListener).not.toHaveBeenCalled();
      
      // Should be able to call cleanup without errors
      expect(() => cleanup()).not.toThrow();
    });
  });
});
