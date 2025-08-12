// React Error Boundaries for Phase 3.2 - Enhanced Error Handling
// Prevents component crashes and provides graceful error recovery

import React from 'react';
import type { EnhancedError, ErrorRecoveryActions } from '../utils/error-enhanced';
import { getErrorRecoveryActions, createEnhancedError } from '../utils/error-enhanced';

// Error boundary state
interface ErrorBoundaryState {
  hasError: boolean;
  error: EnhancedError | null;
  errorInfo: React.ErrorInfo | null;
}

// Error boundary props
interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ComponentType<ErrorFallbackProps>;
  onError?: (error: EnhancedError, errorInfo: React.ErrorInfo) => void;
  isolate?: boolean; // If true, only catches errors from direct children
}

// Props passed to fallback components
export interface ErrorFallbackProps {
  error: EnhancedError;
  resetError: () => void;
  recoveryActions: ErrorRecoveryActions;
}

// Main Error Boundary Component
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  private resetTimeoutId: number | null = null;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    // Convert regular errors to enhanced errors
    const enhancedError = error as EnhancedError;
    if (!('type' in enhancedError)) {
      const newError = createEnhancedError(error);
      return {
        hasError: true,
        error: newError,
      };
    }

    return {
      hasError: true,
      error: enhancedError,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    const enhancedError = this.state.error || createEnhancedError(error);
    
    this.setState({
      errorInfo,
    });

    // Call onError callback if provided
    if (this.props.onError) {
      this.props.onError(enhancedError, errorInfo);
    }

    // Log error for debugging
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  componentWillUnmount() {
    if (this.resetTimeoutId) {
      clearTimeout(this.resetTimeoutId);
    }
  }

  resetError = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      const FallbackComponent = this.props.fallback || DefaultErrorFallback;
      const recoveryActions = getErrorRecoveryActions(this.state.error);

      // Override retry action to reset error boundary
      recoveryActions.retry = async () => {
        this.resetError();
      };

      return (
        <FallbackComponent
          error={this.state.error}
          resetError={this.resetError}
          recoveryActions={recoveryActions}
        />
      );
    }

    return this.props.children;
  }
}

// Default Error Fallback Component
const DefaultErrorFallback: React.FC<ErrorFallbackProps> = ({ 
  error, 
  recoveryActions 
}) => {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          <div className="text-center">
            {/* Error Icon */}
            <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-100">
              <svg
                className="h-6 w-6 text-red-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
                />
              </svg>
            </div>

            {/* Error Message */}
            <h3 className="mt-4 text-lg font-medium text-gray-900">
              Something went wrong
            </h3>
            
            <p className="mt-2 text-sm text-gray-600">
              {error.userMessage}
            </p>

            {error.suggestion && (
              <p className="mt-2 text-sm text-gray-500">
                {error.suggestion}
              </p>
            )}

            {/* Recovery Actions */}
            <div className="mt-6 flex flex-col space-y-3">
              {recoveryActions.retry && (
                <button
                  type="button"
                  onClick={recoveryActions.retry}
                  className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                >
                  Try Again
                </button>
              )}

              {recoveryActions.refresh && (
                <button
                  type="button"
                  onClick={recoveryActions.refresh}
                  className="w-full flex justify-center py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                >
                  Refresh Page
                </button>
              )}

              {recoveryActions.goBack && (
                <button
                  type="button"
                  onClick={recoveryActions.goBack}
                  className="w-full flex justify-center py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                >
                  Go Back
                </button>
              )}
            </div>

            {/* Technical Details (collapsible) */}
            <details className="mt-6 text-left">
              <summary className="text-sm text-gray-500 cursor-pointer hover:text-gray-700">
                Technical Details
              </summary>
              <div className="mt-2 p-3 bg-gray-50 rounded-md">
                <p className="text-xs text-gray-600 font-mono break-all">
                  {error.technicalMessage}
                </p>
                {error.statusCode && (
                  <p className="text-xs text-gray-500 mt-1">
                    Status Code: {error.statusCode}
                  </p>
                )}
                <p className="text-xs text-gray-500 mt-1">
                  Error Type: {error.type}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Timestamp: {new Date(error.timestamp).toLocaleString()}
                </p>
              </div>
            </details>
          </div>
        </div>
      </div>
    </div>
  );
};

// Specialized Error Boundaries for different contexts

// API Error Boundary - for API-related errors
export const ApiErrorBoundary: React.FC<{
  children: React.ReactNode;
  onError?: (error: EnhancedError) => void;
}> = ({ children, onError }) => {
  return (
    <ErrorBoundary
      fallback={ApiErrorFallback}
      onError={(error, errorInfo) => {
        onError?.(error);
        // Could send to error tracking service
        console.error('API Error:', error, errorInfo);
      }}
    >
      {children}
    </ErrorBoundary>
  );
};

// API Error Fallback - more compact for inline errors
const ApiErrorFallback: React.FC<ErrorFallbackProps> = ({ 
  error, 
  recoveryActions 
}) => {
  return (
    <div className="bg-red-50 border border-red-200 rounded-md p-4">
      <div className="flex">
        <div className="flex-shrink-0">
          <svg
            className="h-5 w-5 text-red-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
        <div className="ml-3 flex-1">
          <h3 className="text-sm font-medium text-red-800">
            {error.userMessage}
          </h3>
          {error.suggestion && (
            <p className="mt-1 text-sm text-red-700">
              {error.suggestion}
            </p>
          )}
          <div className="mt-3 flex space-x-3">
            {recoveryActions.retry && (
              <button
                type="button"
                onClick={recoveryActions.retry}
                className="text-sm font-medium text-red-800 underline hover:text-red-900"
              >
                Try again
              </button>
            )}
            {recoveryActions.refresh && (
              <button
                type="button"
                onClick={recoveryActions.refresh}
                className="text-sm font-medium text-red-800 underline hover:text-red-900"
              >
                Refresh
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// Page Error Boundary - for page-level errors
export const PageErrorBoundary: React.FC<{
  children: React.ReactNode;
  pageName?: string;
}> = ({ children, pageName }) => {
  return (
    <ErrorBoundary
      fallback={PageErrorFallback}
      onError={(error, errorInfo) => {
        // Could send to error tracking service with page context
        console.error(`Page Error (${pageName}):`, error, errorInfo);
      }}
    >
      {children}
    </ErrorBoundary>
  );
};

// Page Error Fallback - maintains navigation
const PageErrorFallback: React.FC<ErrorFallbackProps> = ({ 
  error, 
  recoveryActions 
}) => {
  return (
    <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
      <div className="px-4 py-6 sm:px-0">
        <div className="text-center">
          <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-red-100">
            <svg
              className="h-8 w-8 text-red-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
              />
            </svg>
          </div>

          <h1 className="mt-6 text-2xl font-bold text-gray-900">
            Unable to load this page
          </h1>
          
          <p className="mt-2 text-gray-600">
            {error.userMessage}
          </p>

          {error.suggestion && (
            <p className="mt-2 text-sm text-gray-500">
              {error.suggestion}
            </p>
          )}

          <div className="mt-8 flex justify-center space-x-4">
            {recoveryActions.retry && (
              <button
                type="button"
                onClick={recoveryActions.retry}
                className="bg-indigo-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                Try Again
              </button>
            )}
            
            {recoveryActions.goBack && (
              <button
                type="button"
                onClick={recoveryActions.goBack}
                className="bg-white text-gray-700 px-4 py-2 rounded-md text-sm font-medium border border-gray-300 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                Go Back
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
