// Demo page for Phase 3.2 Enhanced Error Handling features
// Demonstrates error boundaries, retry mechanisms, offline support, and user-friendly error messages

import React from 'react';
import { ApiErrorBoundary, PageErrorBoundary } from '../components/ErrorBoundary';
import { useErrorHandler } from '../hooks/useErrorHandler';
import { useWorkingApiEnhanced, useOfflineAwareFetch } from '../hooks/useEnhancedErrorHandling';
import { 
  createEnhancedError, 
  ErrorType 
} from '../utils/error-enhanced';

const ErrorHandlingDemo: React.FC = () => {
  const [demoType, setDemoType] = React.useState<string>('none');
  const { error, hasError, handleError, clearError, retryWithClear } = useErrorHandler();

  // Enhanced API hook demo
  const enhancedDashboard = useWorkingApiEnhanced({
    enableRetry: true,
    enableOfflineSupport: true,
    staleWhileRevalidate: true,
    backgroundRefresh: false,
  });

  // Offline support demo
  const { isOffline } = useOfflineAwareFetch();

  // Demo error triggers
  const triggerNetworkError = () => {
    const error = createEnhancedError(new Error('Failed to fetch'), undefined, 'Network connection failed');
    error.type = ErrorType.NETWORK;
    handleError(error);
  };

  const triggerServerError = () => {
    const error = createEnhancedError(new Error('Internal server error'), undefined, 'Server returned 500');
    error.type = ErrorType.SERVER;
    handleError(error);
  };

  const triggerValidationError = () => {
    const error = createEnhancedError(new Error('Invalid input'), undefined, 'Field validation failed');
    error.type = ErrorType.VALIDATION;
    handleError(error);
  };

  const triggerOfflineError = () => {
    const error = createEnhancedError(new Error('No connection'), undefined, 'Device is offline');
    error.type = ErrorType.OFFLINE;
    handleError(error);
  };

  const triggerPermissionError = () => {
    const error = createEnhancedError(new Error('Access denied'), undefined, 'User lacks permission');
    error.type = ErrorType.PERMISSION;
    handleError(error);
  };

  // Component that throws an error for boundary demo
  const ErrorThrowingComponent: React.FC<{ shouldThrow: boolean }> = ({ shouldThrow }) => {
    if (shouldThrow) {
      throw createEnhancedError(new Error('Component crashed'), undefined, 'React component error');
    }
    return <div className="p-4 bg-green-50 border border-green-200 rounded-md">
      <p className="text-green-800">Component rendered successfully!</p>
    </div>;
  };

  return (
    <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
      <div className="px-4 py-6 sm:px-0">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">
          Enhanced Error Handling Demo
        </h1>
        
        <p className="text-gray-600 mb-8">
          This page demonstrates the Phase 3.2 enhanced error handling features including 
          user-friendly error messages, automatic retry mechanisms, offline support, and error boundaries.
        </p>

        {/* Network Status */}
        <div className="mb-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Network Status</h2>
          <div className={`p-4 rounded-md ${isOffline ? 'bg-red-50 border border-red-200' : 'bg-green-50 border border-green-200'}`}>
            <div className="flex items-center">
              <div className={`w-3 h-3 rounded-full mr-3 ${isOffline ? 'bg-red-500' : 'bg-green-500'}`}></div>
              <span className={isOffline ? 'text-red-800' : 'text-green-800'}>
                {isOffline ? 'Offline - Some features may not be available' : 'Online - All features available'}
              </span>
            </div>
          </div>
        </div>

        {/* Enhanced API Demo */}
        <div className="mb-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Enhanced API with Retry & Offline Support</h2>
          <div className="bg-white shadow rounded-lg p-6">
            <div className="mb-4">
              <h3 className="text-lg font-medium text-gray-900 mb-2">Dashboard API Status</h3>
              {enhancedDashboard.loading && (
                <p className="text-gray-600">Loading dashboard data...</p>
              )}
              {enhancedDashboard.retrying && (
                <p className="text-orange-600">Retrying request... (Attempt {enhancedDashboard.retryCount})</p>
              )}
              {enhancedDashboard.error && (
                <div className="bg-red-50 border border-red-200 rounded-md p-4">
                  <h4 className="font-medium text-red-800">{enhancedDashboard.error.userMessage}</h4>
                  {enhancedDashboard.error.suggestion && (
                    <p className="text-red-700 text-sm mt-1">{enhancedDashboard.error.suggestion}</p>
                  )}
                  <div className="mt-3 flex space-x-3">
                    {enhancedDashboard.canRetry && (
                      <button
                        onClick={enhancedDashboard.retry}
                        disabled={enhancedDashboard.isRetryInProgress}
                        className="text-red-800 underline hover:text-red-900 disabled:opacity-50"
                      >
                        {enhancedDashboard.isRetryInProgress ? 'Retrying...' : 'Retry Now'}
                      </button>
                    )}
                    <button
                      onClick={() => enhancedDashboard.refetch()}
                      className="text-red-800 underline hover:text-red-900"
                    >
                      Refresh
                    </button>
                  </div>
                </div>
              )}
              {enhancedDashboard.data && (
                <div className="bg-green-50 border border-green-200 rounded-md p-4">
                  <p className="text-green-800">Dashboard data loaded successfully!</p>
                  <p className="text-green-600 text-sm mt-1">
                    {enhancedDashboard.data.deploymentsCount} deployments, 
                    {enhancedDashboard.data.activeJobsCount} active jobs
                  </p>
                  {enhancedDashboard.hasStaleData && (
                    <p className="text-orange-600 text-sm mt-1">Showing cached data while refreshing...</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Error Type Demonstrations */}
        <div className="mb-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Error Type Demonstrations</h2>
          <div className="bg-white shadow rounded-lg p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
              <button
                onClick={triggerNetworkError}
                className="bg-red-100 text-red-800 py-2 px-4 rounded-md hover:bg-red-200 transition-colors"
              >
                Trigger Network Error
              </button>
              <button
                onClick={triggerServerError}
                className="bg-orange-100 text-orange-800 py-2 px-4 rounded-md hover:bg-orange-200 transition-colors"
              >
                Trigger Server Error
              </button>
              <button
                onClick={triggerValidationError}
                className="bg-yellow-100 text-yellow-800 py-2 px-4 rounded-md hover:bg-yellow-200 transition-colors"
              >
                Trigger Validation Error
              </button>
              <button
                onClick={triggerOfflineError}
                className="bg-gray-100 text-gray-800 py-2 px-4 rounded-md hover:bg-gray-200 transition-colors"
              >
                Trigger Offline Error
              </button>
              <button
                onClick={triggerPermissionError}
                className="bg-purple-100 text-purple-800 py-2 px-4 rounded-md hover:bg-purple-200 transition-colors"
              >
                Trigger Permission Error
              </button>
              <button
                onClick={clearError}
                className="bg-green-100 text-green-800 py-2 px-4 rounded-md hover:bg-green-200 transition-colors"
              >
                Clear Error
              </button>
            </div>

            {hasError && error && (
              <div className="bg-red-50 border border-red-200 rounded-md p-4">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <svg className="h-5 w-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
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
                      {error.retryable && (
                        <button
                          onClick={() => retryWithClear(async () => {
                            // Simulate API call
                            await new Promise(resolve => setTimeout(resolve, 1000));
                          })}
                          className="text-sm font-medium text-red-800 underline hover:text-red-900"
                        >
                          Try again
                        </button>
                      )}
                      <button
                        onClick={clearError}
                        className="text-sm font-medium text-red-800 underline hover:text-red-900"
                      >
                        Dismiss
                      </button>
                    </div>
                    <details className="mt-4">
                      <summary className="text-sm text-red-600 cursor-pointer">Technical Details</summary>
                      <div className="mt-2 p-2 bg-red-100 rounded text-xs font-mono">
                        <p><strong>Type:</strong> {error.type}</p>
                        <p><strong>Technical Message:</strong> {error.technicalMessage}</p>
                        <p><strong>Retryable:</strong> {error.retryable ? 'Yes' : 'No'}</p>
                        <p><strong>Timestamp:</strong> {new Date(error.timestamp).toLocaleString()}</p>
                        {error.statusCode && <p><strong>Status Code:</strong> {error.statusCode}</p>}
                      </div>
                    </details>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Error Boundary Demonstrations */}
        <div className="mb-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Error Boundary Demonstrations</h2>
          
          {/* API Error Boundary Demo */}
          <div className="mb-6">
            <h3 className="text-lg font-medium text-gray-900 mb-2">API Error Boundary</h3>
            <ApiErrorBoundary>
              <div className="bg-white shadow rounded-lg p-6">
                <p className="mb-4">This section is protected by an API Error Boundary.</p>
                <button
                  onClick={() => setDemoType(demoType === 'api-error' ? 'none' : 'api-error')}
                  className="bg-red-600 text-white py-2 px-4 rounded-md hover:bg-red-700"
                >
                  {demoType === 'api-error' ? 'Stop Error' : 'Trigger Component Error'}
                </button>
                <ErrorThrowingComponent shouldThrow={demoType === 'api-error'} />
              </div>
            </ApiErrorBoundary>
          </div>

          {/* Page Error Boundary Demo */}
          <div className="mb-6">
            <h3 className="text-lg font-medium text-gray-900 mb-2">Page Error Boundary</h3>
            <PageErrorBoundary pageName="Error Demo">
              <div className="bg-white shadow rounded-lg p-6">
                <p className="mb-4">This section is protected by a Page Error Boundary.</p>
                <button
                  onClick={() => setDemoType(demoType === 'page-error' ? 'none' : 'page-error')}
                  className="bg-orange-600 text-white py-2 px-4 rounded-md hover:bg-orange-700"
                >
                  {demoType === 'page-error' ? 'Stop Error' : 'Trigger Page Error'}
                </button>
                <ErrorThrowingComponent shouldThrow={demoType === 'page-error'} />
              </div>
            </PageErrorBoundary>
          </div>
        </div>

        {/* Feature Summary */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h2 className="text-xl font-semibold text-blue-900 mb-4">Phase 3.2 Features Summary</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="font-medium text-blue-900 mb-2">✅ User-Friendly Error Messages</h3>
              <ul className="text-blue-800 text-sm space-y-1">
                <li>• Error classification by type (network, server, validation, etc.)</li>
                <li>• User-actionable error messages</li>
                <li>• Helpful suggestions for error resolution</li>
                <li>• Technical details available on demand</li>
              </ul>
            </div>
            
            <div>
              <h3 className="font-medium text-blue-900 mb-2">✅ Enhanced Retry Mechanisms</h3>
              <ul className="text-blue-800 text-sm space-y-1">
                <li>• Automatic retry with exponential backoff</li>
                <li>• Configurable retry policies per error type</li>
                <li>• Jittered delays to prevent thundering herd</li>
                <li>• Manual retry capabilities</li>
              </ul>
            </div>
            
            <div>
              <h3 className="font-medium text-blue-900 mb-2">✅ Offline Support</h3>
              <ul className="text-blue-800 text-sm space-y-1">
                <li>• Network status detection and monitoring</li>
                <li>• Graceful degradation when offline</li>
                <li>• Automatic retry when connection restored</li>
                <li>• Stale-while-revalidate caching strategy</li>
              </ul>
            </div>
            
            <div>
              <h3 className="font-medium text-blue-900 mb-2">✅ Error Boundaries</h3>
              <ul className="text-blue-800 text-sm space-y-1">
                <li>• React error boundaries prevent app crashes</li>
                <li>• Specialized boundaries for different contexts</li>
                <li>• Graceful fallback UI with recovery options</li>
                <li>• Error reporting and debugging support</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ErrorHandlingDemo;
