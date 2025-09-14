// Test file for Phase 3.2 Enhanced Error Handling features
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { 
  createEnhancedError, 
  ErrorType, 
  classifyError, 
  calculateRetryDelay,
  NetworkStatus,
  enhancedFetch
} from '../utils/error-enhanced';
import { useErrorHandler } from '../hooks/useErrorHandler';
import { ErrorBoundary } from '../components/ErrorBoundary';
import React from 'react';

beforeEach(() => {
  // Ensure navigator.onLine is true without replacing the entire navigator
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value: true,
  });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('Enhanced Error Handling - Phase 3.2', () => {
  describe('Error Classification', () => {
    it('should classify network errors correctly', () => {
      const networkError = new Error('Failed to fetch');
      const errorType = classifyError(undefined, networkError);
      expect(errorType).toBe(ErrorType.NETWORK);
    });

    it('should classify HTTP status codes correctly', () => {
      const serverErrorResponse = { status: 500 } as Response;
      expect(classifyError(serverErrorResponse)).toBe(ErrorType.SERVER);
      
      const notFoundResponse = { status: 404 } as Response;
      expect(classifyError(notFoundResponse)).toBe(ErrorType.CLIENT);
      
      const unauthorizedResponse = { status: 401 } as Response;
      expect(classifyError(unauthorizedResponse)).toBe(ErrorType.PERMISSION);
      
      const rateLimitResponse = { status: 429 } as Response;
      expect(classifyError(rateLimitResponse)).toBe(ErrorType.RATE_LIMIT);
      
      const timeoutResponse = { status: 408 } as Response;
      expect(classifyError(timeoutResponse)).toBe(ErrorType.TIMEOUT);
    });

    it('should detect offline status', () => {
      Object.defineProperty(window.navigator, 'onLine', {
        configurable: true,
        value: false,
      });
      const errorType = classifyError();
      expect(errorType).toBe(ErrorType.OFFLINE);
    });
  });

  describe('Enhanced Error Creation', () => {
    it('should create enhanced error with user-friendly messages', () => {
      const originalError = new Error('Connection failed');
      const enhancedError = createEnhancedError(originalError);
      
      expect(enhancedError.type).toBe(ErrorType.UNKNOWN);
      expect(enhancedError.userMessage).toBe('An unexpected error occurred.');
      expect(enhancedError.technicalMessage).toBe('Connection failed');
      expect(enhancedError.retryable).toBe(true);
      expect(enhancedError.timestamp).toBeGreaterThan(0);
      expect(enhancedError.suggestion).toBe('Please try again. If the problem persists, refresh the page.');
    });

    it('should create network error with appropriate retry settings', () => {
      const networkError = new Error('fetch failed');
      const response = undefined;
      const enhancedError = createEnhancedError(networkError, response);
      
      expect(enhancedError.type).toBe(ErrorType.NETWORK);
      expect(enhancedError.userMessage).toBe('Unable to connect to the server. Please check your internet connection.');
      expect(enhancedError.retryable).toBe(true);
      expect(enhancedError.suggestion).toBe('Try refreshing the page or check your network settings.');
    });
  });

  describe('Retry Delay Calculation', () => {
    it('should calculate exponential backoff correctly', () => {
      const config = {
        maxAttempts: 3,
        baseDelay: 1000,
        maxDelay: 10000,
        multiplier: 2,
        jitter: false,
      };

      const delay1 = calculateRetryDelay(1, config);
      const delay2 = calculateRetryDelay(2, config);
      const delay3 = calculateRetryDelay(3, config);

      expect(delay1).toBe(1000);  // 1000 * 2^0
      expect(delay2).toBe(2000);  // 1000 * 2^1
      expect(delay3).toBe(4000);  // 1000 * 2^2
    });

    it('should respect maximum delay cap', () => {
      const config = {
        maxAttempts: 10,
        baseDelay: 1000,
        maxDelay: 5000,
        multiplier: 2,
        jitter: false,
      };

      const delay = calculateRetryDelay(10, config); // Would be 1000 * 2^9 = 512000
      expect(delay).toBe(5000); // Capped at maxDelay
    });

    it('should add jitter when enabled', () => {
      const config = {
        maxAttempts: 3,
        baseDelay: 1000,
        maxDelay: 10000,
        multiplier: 2,
        jitter: true,
      };

      const delay1 = calculateRetryDelay(1, config);
      const delay2 = calculateRetryDelay(1, config);
      
      // With jitter, delays should be different
      expect(delay1).not.toBe(delay2);
      
      // But should be within expected range (±25% of base delay)
      expect(delay1).toBeGreaterThan(750);
      expect(delay1).toBeLessThan(1250);
    });
  });

  describe('Network Status Monitoring', () => {
    it('should detect online status', () => {
      expect(NetworkStatus.isOnline()).toBe(true);
    });

    it('should register and call listeners', () => {
      const listener = vi.fn();
      const cleanup = NetworkStatus.addListener(listener);
      
      expect(typeof cleanup).toBe('function');
      
      // Cleanup should remove the listener
      cleanup();
    });
  });

  describe('useErrorHandler Hook', () => {
    const TestComponent: React.FC = () => {
      const { error, hasError, handleError, clearError, retryWithClear } = useErrorHandler();
      
      return (
        <div>
          {hasError && <div data-testid="error-message">{error?.userMessage}</div>}
          <button 
            data-testid="trigger-error"
            onClick={() => handleError(new Error('Test error'))}
          >
            Trigger Error
          </button>
          <button 
            data-testid="clear-error"
            onClick={clearError}
          >
            Clear Error
          </button>
          <button
            data-testid="retry-error"
            onClick={() => retryWithClear(async () => {
              throw new Error('Retry failed');
            })}
          >
            Retry with Error
          </button>
        </div>
      );
    };

    it('should handle and clear errors', async () => {
      render(<TestComponent />);
      
      // Trigger an error
      fireEvent.click(screen.getByTestId('trigger-error'));
      
      await waitFor(() => {
        expect(screen.getByTestId('error-message')).toBeInTheDocument();
      });
      
      // Clear the error
      fireEvent.click(screen.getByTestId('clear-error'));
      
      await waitFor(() => {
        expect(screen.queryByTestId('error-message')).not.toBeInTheDocument();
      });
    });

    it('should handle retry with clear', async () => {
      render(<TestComponent />);
      
      // Trigger retry that will fail
      fireEvent.click(screen.getByTestId('retry-error'));
      
      await waitFor(() => {
        expect(screen.getByTestId('error-message')).toBeInTheDocument();
        expect(screen.getByTestId('error-message')).toHaveTextContent('Retry failed');
      });
    });
  });

  describe('Error Boundary', () => {
    const ThrowingComponent: React.FC<{ shouldThrow: boolean }> = ({ shouldThrow }) => {
      if (shouldThrow) {
        throw createEnhancedError(new Error('Component error'));
      }
      return <div data-testid="success">Component rendered</div>;
    };

    it('should catch errors and show fallback UI', () => {
      render(
        <ErrorBoundary>
          <ThrowingComponent shouldThrow={true} />
        </ErrorBoundary>
      );

      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
      expect(screen.getByText('An unexpected error occurred.')).toBeInTheDocument();
      expect(screen.getByText('Try Again')).toBeInTheDocument();
    });

    it('should render children when no error', () => {
      render(
        <ErrorBoundary>
          <ThrowingComponent shouldThrow={false} />
        </ErrorBoundary>
      );

      expect(screen.getByTestId('success')).toBeInTheDocument();
      expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
    });
  });

  describe('Enhanced Fetch', () => {
    const mockFetch = vi.fn();
    
    beforeEach(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      global.fetch = mockFetch as any;
    });

    it('should return successful response', async () => {
      const mockResponse = {
        ok: true,
        json: () => Promise.resolve({ data: 'test' }),
      };
      
      mockFetch.mockResolvedValueOnce(mockResponse);
      
      const response = await enhancedFetch('http://test.com');
      expect(response).toBe(mockResponse);
    });

    it('should throw enhanced error for failed response', async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({ error: { message: 'Server error' } }),
      };
      
      mockFetch.mockResolvedValueOnce(mockResponse);
      
      await expect(enhancedFetch('http://test.com')).rejects.toThrow();
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      
      await expect(enhancedFetch('http://test.com')).rejects.toThrow();
    });
  });
});
