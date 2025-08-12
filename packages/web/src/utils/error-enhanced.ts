// Enhanced error handling system for Phase 3.2
// Provides user-friendly error messages, retry mechanisms, and offline support

import type { ErrorResponse as SharedErrorResponse } from '@hola/shared';

export type ErrorResponse = SharedErrorResponse;

// Error classification for different handling strategies
export enum ErrorType {
  NETWORK = 'network',           // Connection issues, DNS failures
  SERVER = 'server',             // 5xx errors
  CLIENT = 'client',             // 4xx errors
  TIMEOUT = 'timeout',           // Request timeouts
  OFFLINE = 'offline',           // Device is offline
  VALIDATION = 'validation',     // Data validation errors
  PERMISSION = 'permission',     // Authentication/authorization
  RATE_LIMIT = 'rate_limit',     // Too many requests
  UNKNOWN = 'unknown'            // Fallback
}

// Enhanced error information with user-friendly messaging
export interface EnhancedError extends Error {
  type: ErrorType;
  userMessage: string;
  technicalMessage: string;
  retryable: boolean;
  statusCode?: number;
  timestamp: number;
  suggestion?: string;
}

// Retry configuration with exponential backoff
export interface RetryConfig {
  maxAttempts: number;
  baseDelay: number;           // Base delay in milliseconds
  maxDelay: number;            // Maximum delay cap
  multiplier: number;          // Exponential multiplier
  jitter: boolean;            // Add randomization to prevent thundering herd
}

// Default retry configurations by error type
export const DEFAULT_RETRY_CONFIGS: Record<ErrorType, RetryConfig | null> = {
  [ErrorType.NETWORK]: { maxAttempts: 3, baseDelay: 1000, maxDelay: 10000, multiplier: 2, jitter: true },
  [ErrorType.SERVER]: { maxAttempts: 3, baseDelay: 2000, maxDelay: 15000, multiplier: 2, jitter: true },
  [ErrorType.TIMEOUT]: { maxAttempts: 2, baseDelay: 5000, maxDelay: 20000, multiplier: 2, jitter: true },
  [ErrorType.OFFLINE]: null, // No retries when offline - wait for network recovery
  [ErrorType.RATE_LIMIT]: { maxAttempts: 2, baseDelay: 30000, maxDelay: 120000, multiplier: 2, jitter: true },
  [ErrorType.CLIENT]: null, // Don't retry client errors
  [ErrorType.VALIDATION]: null, // Don't retry validation errors
  [ErrorType.PERMISSION]: null, // Don't retry auth errors
  [ErrorType.UNKNOWN]: { maxAttempts: 1, baseDelay: 2000, maxDelay: 5000, multiplier: 1.5, jitter: true },
};

// User-friendly error messages mapping
const ERROR_MESSAGES: Record<ErrorType, { title: string; message: string; suggestion?: string }> = {
  [ErrorType.NETWORK]: {
    title: 'Connection Problem',
    message: 'Unable to connect to the server. Please check your internet connection.',
    suggestion: 'Try refreshing the page or check your network settings.'
  },
  [ErrorType.SERVER]: {
    title: 'Server Error',
    message: 'The server encountered an error while processing your request.',
    suggestion: 'Please try again in a few moments. If the problem persists, contact support.'
  },
  [ErrorType.CLIENT]: {
    title: 'Request Error',
    message: 'There was a problem with your request.',
    suggestion: 'Please check your input and try again.'
  },
  [ErrorType.TIMEOUT]: {
    title: 'Request Timeout',
    message: 'The server took too long to respond.',
    suggestion: 'Please try again. If you\'re performing a large operation, it may need more time.'
  },
  [ErrorType.OFFLINE]: {
    title: 'No Internet Connection',
    message: 'You appear to be offline. Some features may not be available.',
    suggestion: 'Please check your internet connection and try again.'
  },
  [ErrorType.VALIDATION]: {
    title: 'Invalid Data',
    message: 'The information provided is not valid.',
    suggestion: 'Please check your input and ensure all required fields are filled correctly.'
  },
  [ErrorType.PERMISSION]: {
    title: 'Access Denied',
    message: 'You don\'t have permission to perform this action.',
    suggestion: 'Please log in or contact an administrator for access.'
  },
  [ErrorType.RATE_LIMIT]: {
    title: 'Too Many Requests',
    message: 'You\'re making requests too quickly.',
    suggestion: 'Please wait a moment before trying again.'
  },
  [ErrorType.UNKNOWN]: {
    title: 'Unexpected Error',
    message: 'An unexpected error occurred.',
    suggestion: 'Please try again. If the problem persists, refresh the page.'
  },
};

// Enhanced error classification from Response
export function classifyError(response?: Response, error?: Error): ErrorType {
  // Check if device is offline
  if (!navigator.onLine) {
    return ErrorType.OFFLINE;
  }

  // Handle network errors (no response)
  if (!response && error) {
    if (error.name === 'AbortError') {
      return ErrorType.TIMEOUT;
    }
    if (error.message.includes('fetch') || error.message.includes('network')) {
      return ErrorType.NETWORK;
    }
    return ErrorType.UNKNOWN;
  }

  // Handle HTTP status codes
  if (response) {
    const status = response.status;
    
    if (status >= 500) {
      return ErrorType.SERVER;
    }
    
    if (status === 429) {
      return ErrorType.RATE_LIMIT;
    }
    
    if (status === 401 || status === 403) {
      return ErrorType.PERMISSION;
    }
    
    if (status === 408 || status === 504) {
      return ErrorType.TIMEOUT;
    }
    
    if (status === 400 || status === 422) {
      return ErrorType.VALIDATION;
    }
    
    if (status >= 400 && status < 500) {
      return ErrorType.CLIENT;
    }
  }

  return ErrorType.UNKNOWN;
}

// Create enhanced error with user-friendly messaging
export function createEnhancedError(
  error: Error,
  response?: Response,
  technicalDetails?: string
): EnhancedError {
  const errorType = classifyError(response, error);
  const messageInfo = ERROR_MESSAGES[errorType];
  const statusCode = response?.status;

  const enhancedError = Object.assign(error, {
    type: errorType,
    userMessage: messageInfo.message,
    technicalMessage: technicalDetails || error.message,
    retryable: DEFAULT_RETRY_CONFIGS[errorType] !== null,
    statusCode,
    timestamp: Date.now(),
    suggestion: messageInfo.suggestion,
  } as Partial<EnhancedError>) as EnhancedError;

  return enhancedError;
}

// Enhanced error message extraction with better parsing
export async function toEnhancedErrorMessage(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as Partial<ErrorResponse> | unknown;
    
    // Try to extract detailed error message
    let serverMessage = '';
    
    if (typeof data === 'object' && data !== null) {
      // Check for nested error structure
      if ('error' in data) {
        const errorObj = (data as { error?: unknown }).error;
        if (typeof errorObj === 'object' && errorObj !== null) {
          if ('message' in errorObj && typeof (errorObj as { message?: unknown }).message === 'string') {
            serverMessage = (errorObj as { message: string }).message;
          }
          // Check for validation errors array
          if ('details' in errorObj && Array.isArray((errorObj as { details?: unknown }).details)) {
            const details = (errorObj as { details: unknown[] }).details;
            const validationErrors = details
              .filter((detail): detail is { message: string } => 
                typeof detail === 'object' && detail !== null && 'message' in detail
              )
              .map(detail => detail.message);
            
            if (validationErrors.length > 0) {
              serverMessage = validationErrors.join('; ');
            }
          }
        }
      }
      
      // Check for direct message field
      if (!serverMessage && 'message' in data && typeof (data as { message?: unknown }).message === 'string') {
        serverMessage = (data as { message: string }).message;
      }
    }

    // Return server message if available and meaningful
    if (serverMessage && serverMessage.trim().length > 0) {
      return serverMessage;
    }

    // Fallback to status-based message
    const errorType = classifyError(res);
    return ERROR_MESSAGES[errorType].message;
    
  } catch {
    // If JSON parsing fails, use status-based message
    const errorType = classifyError(res);
    return ERROR_MESSAGES[errorType].message;
  }
}

// Calculate delay for exponential backoff with jitter
export function calculateRetryDelay(
  attempt: number,
  config: RetryConfig
): number {
  const exponentialDelay = Math.min(
    config.baseDelay * Math.pow(config.multiplier, attempt - 1),
    config.maxDelay
  );

  if (config.jitter) {
    // Add ±25% jitter to prevent thundering herd
    const jitterRange = exponentialDelay * 0.25;
    const jitter = (Math.random() - 0.5) * 2 * jitterRange;
    return Math.max(0, exponentialDelay + jitter);
  }

  return exponentialDelay;
}

// Enhanced fetch with automatic retry logic
export async function enhancedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  retryConfig?: Partial<RetryConfig>
): Promise<Response> {
  const executeRequest = async (): Promise<Response> => {
    try {
      const response = await fetch(input, init);
      
      if (!response.ok) {
        const errorMessage = await toEnhancedErrorMessage(response);
        const error = new Error(errorMessage);
        throw createEnhancedError(error, response);
      }
      
      return response;
    } catch (err) {
      if (err instanceof Error) {
        const enhancedError = err as EnhancedError;
        if ('type' in enhancedError) {
          throw enhancedError;
        }
        throw createEnhancedError(err);
      }
      throw createEnhancedError(new Error('Unknown error'));
    }
  };

  // Try initial request
  let lastError: EnhancedError;
  try {
    return await executeRequest();
  } catch (error) {
    lastError = error as EnhancedError;
  }

  // Determine retry configuration
  const defaultConfig = DEFAULT_RETRY_CONFIGS[lastError.type];
  const config = defaultConfig ? {
    ...defaultConfig,
    ...retryConfig,
  } : null;

  // Don't retry if not retryable or no retry config
  if (!lastError.retryable || !config) {
    throw lastError;
  }

  // Retry with exponential backoff
  let attempt = 1;
  while (attempt < config.maxAttempts) {
    attempt++;
    
    const delay = calculateRetryDelay(attempt, config);
    await new Promise(resolve => setTimeout(resolve, delay));

    try {
      return await executeRequest();
    } catch (error) {
      lastError = error as EnhancedError;
      if (attempt >= config.maxAttempts) {
        throw lastError;
      }
      // Continue to next retry attempt
    }
  }

  throw lastError;
}

// Enhanced safeFetch replacement with retry support
export async function safeFetchEnhanced(
  input: RequestInfo | URL,
  init?: RequestInit,
  retryConfig?: Partial<RetryConfig>
): Promise<Response> {
  try {
    return await enhancedFetch(input, init, retryConfig);
  } catch (err) {
    // Ensure we always throw an EnhancedError
    if (err instanceof Error && !(err as EnhancedError).type) {
      throw createEnhancedError(err);
    }
    throw err;
  }
}

// Network status utilities for offline support
export class NetworkStatus {
  private static listeners: ((online: boolean) => void)[] = [];
  private static isInitialized = false;

  static isOnline(): boolean {
    return navigator.onLine;
  }

  static addListener(callback: (online: boolean) => void): () => void {
    this.initializeIfNeeded();
    this.listeners.push(callback);
    
    // Return cleanup function
    return () => {
      const index = this.listeners.indexOf(callback);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  private static initializeIfNeeded(): void {
    if (this.isInitialized) return;
    
    const handleOnline = () => this.notifyListeners(true);
    const handleOffline = () => this.notifyListeners(false);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    this.isInitialized = true;
  }

  private static notifyListeners(online: boolean): void {
    this.listeners.forEach(callback => {
      try {
        callback(online);
      } catch (error) {
        console.error('Error in network status listener:', error);
      }
    });
  }
}

// Error recovery utilities
export interface ErrorRecoveryActions {
  retry?: () => Promise<void>;
  refresh?: () => void;
  goBack?: () => void;
  contactSupport?: () => void;
}

export function getErrorRecoveryActions(error: EnhancedError): ErrorRecoveryActions {
  const actions: ErrorRecoveryActions = {};

  // Add retry action for retryable errors
  if (error.retryable) {
    actions.retry = async () => {
      // This will be implemented by the calling component
      throw new Error('Retry action must be implemented by caller');
    };
  }

  // Add refresh action for certain error types
  if ([ErrorType.SERVER, ErrorType.TIMEOUT, ErrorType.NETWORK].includes(error.type)) {
    actions.refresh = () => window.location.reload();
  }

  // Add go back action for client errors
  if (error.type === ErrorType.CLIENT || error.type === ErrorType.PERMISSION) {
    actions.goBack = () => window.history.back();
  }

  // Add contact support for persistent server errors
  if (error.type === ErrorType.SERVER || error.type === ErrorType.UNKNOWN) {
    actions.contactSupport = () => {
      // This could open a support modal or navigate to support page
      console.log('Contact support action triggered');
    };
  }

  return actions;
}
