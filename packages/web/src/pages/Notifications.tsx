import React, { useState, useCallback } from 'react';
import { Bell, X, Clock, AlertTriangle, CheckCircle, Info, ChevronLeft, ChevronRight } from 'lucide-react';
import type { 
  NotificationItem, 
  NotificationType
} from '@hola/shared';
import { useNotificationsApi } from '../hooks/useNotificationsApi';

// Helper functions
const getTypeIcon = (type: NotificationType) => {
  switch (type) {
    case 'error':
      return <AlertTriangle className="w-5 h-5 text-danger" />;
    case 'success':
      return <CheckCircle className="w-5 h-5 text-success" />;
    case 'warning':
      return <AlertTriangle className="w-5 h-5 text-warning" />;
    case 'info':
      return <Info className="w-5 h-5 text-info" />;
    case 'update':
      return <Bell className="w-5 h-5 text-primary" />;
    default:
      return <Bell className="w-5 h-5 text-text-muted" />;
  }
};

const getTypeColor = (type: NotificationType) => {
  switch (type) {
    case 'error':
      return 'border-l-danger bg-danger/5';
    case 'success':
      return 'border-l-success bg-success/5';
    case 'warning':
      return 'border-l-warning bg-warning/5';
    case 'info':
      return 'border-l-info bg-info/5';
    case 'update':
      return 'border-l-primary bg-primary/5';
    default:
      return 'border-l-border bg-surface-1';
  }
};

const formatRelativeTime = (timestamp: string): string => {
  const now = new Date();
  const date = new Date(timestamp);
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);

  if (diffHours < 1) {
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    return diffMinutes <= 1 ? 'just now' : `${diffMinutes} minutes ago`;
  } else if (diffDays < 1) {
    return diffHours === 1 ? '1 hour ago' : `${diffHours} hours ago`;
  } else {
    return diffDays === 1 ? '1 day ago' : `${diffDays} days ago`;
  }
};

export const Notifications: React.FC = () => {
  // State management
  const [filter, setFilter] = useState<'all' | 'unread' | `type:${NotificationType}`>('all');
  const [currentPage, setCurrentPage] = useState(1);
  
  // Use API hook for data fetching
  const { 
    data: notificationsData, 
    loading, 
    error, 
    refetch,
    markAsRead,
    dismissNotification,
    markAllAsRead,
    dismissAll
  } = useNotificationsApi(filter, currentPage);
  
  // Operations state
  const [operationLoading, setOperationLoading] = useState<{ [key: string]: boolean }>({});

  // Handle individual operations
  const handleMarkAsRead = useCallback(async (id: string) => {
    const operationKey = `mark-read-${id}`;
    setOperationLoading(prev => ({ ...prev, [operationKey]: true }));
    
    try {
      await markAsRead(id);
    } catch (err) {
      console.error('Failed to mark notification as read:', err);
    } finally {
      setOperationLoading(prev => ({ ...prev, [operationKey]: false }));
    }
  }, [markAsRead]);

  const handleDismissNotification = useCallback(async (id: string) => {
    const operationKey = `dismiss-${id}`;
    setOperationLoading(prev => ({ ...prev, [operationKey]: true }));
    
    try {
      await dismissNotification(id);
    } catch (err) {
      console.error('Failed to dismiss notification:', err);
    } finally {
      setOperationLoading(prev => ({ ...prev, [operationKey]: false }));
    }
  }, [dismissNotification]);

  const handleMarkAllAsRead = useCallback(async () => {
    setOperationLoading(prev => ({ ...prev, 'mark-all-read': true }));
    
    try {
      await markAllAsRead();
    } catch (err) {
      console.error('Failed to mark all notifications as read:', err);
    } finally {
      setOperationLoading(prev => ({ ...prev, 'mark-all-read': false }));
    }
  }, [markAllAsRead]);

  const handleDismissAll = useCallback(async () => {
    setOperationLoading(prev => ({ ...prev, 'dismiss-all': true }));
    
    try {
      await dismissAll();
    } catch (err) {
      console.error('Failed to dismiss all notifications:', err);
    } finally {
      setOperationLoading(prev => ({ ...prev, 'dismiss-all': false }));
    }
  }, [dismissAll]);

  // Handle page change
  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page);
  }, []);

  // Handle filter changes
  const handleFilterChange = useCallback((newFilter: typeof filter) => {
    setFilter(newFilter);
    setCurrentPage(1);
  }, []);

  const unreadCount = notificationsData?.unreadCount ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Notifications</h1>
          <p className="text-text-muted mt-1">
            Stay updated with system alerts and application status
            {unreadCount > 0 && (
              <span className="ml-2 bg-danger text-white text-xs px-2 py-1 rounded-full">
                {unreadCount} unread
              </span>
            )}
          </p>
        </div>

        <div className="flex space-x-2">
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllAsRead}
              disabled={operationLoading['mark-all-read']}
              className="px-4 py-2 bg-surface-1 border border-border rounded-lg text-sm font-medium hover:bg-surface-2 transition-colors disabled:opacity-50"
            >
              {operationLoading['mark-all-read'] ? 'Marking...' : 'Mark All Read'}
            </button>
          )}
          <button
            onClick={handleDismissAll}
            disabled={operationLoading['dismiss-all']}
            className="px-4 py-2 bg-surface-1 border border-border rounded-lg text-sm font-medium hover:bg-surface-2 transition-colors disabled:opacity-50"
          >
            {operationLoading['dismiss-all'] ? 'Dismissing...' : 'Dismiss All'}
          </button>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-danger/10 border border-danger/20 text-danger px-4 py-3 rounded-lg flex items-center space-x-2">
          <AlertTriangle className="w-4 h-4" />
          <span>{error}</span>
          <button
            onClick={() => refetch()}
            className="ml-auto p-1 hover:bg-danger/20 rounded transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {[
          { key: 'all' as const, label: 'All' },
          { key: 'unread' as const, label: 'Unread' },
          { key: 'type:error' as const, label: 'Errors' },
          { key: 'type:warning' as const, label: 'Warnings' },
          { key: 'type:update' as const, label: 'Updates' },
          { key: 'type:success' as const, label: 'Success' },
          { key: 'type:info' as const, label: 'Info' },
        ].map(filterOption => (
          <button
            key={filterOption.key}
            onClick={() => handleFilterChange(filterOption.key)}
            disabled={loading}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
              filter === filterOption.key
                ? 'bg-primary text-primary-contrast'
                : 'bg-surface-1 border border-border text-text-muted hover:text-text-strong hover:bg-surface-2'
            }`}
          >
            {filterOption.label}
          </button>
        ))}
      </div>

      {/* Notifications List */}
      <div className="space-y-3">
        {loading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="border-l-4 border-l-border rounded-lg p-4 bg-surface-1 animate-pulse">
                <div className="flex items-start space-x-3">
                  <div className="w-5 h-5 bg-surface-2 rounded"></div>
                  <div className="flex-grow space-y-2">
                    <div className="h-4 bg-surface-2 rounded w-1/3"></div>
                    <div className="h-3 bg-surface-2 rounded w-3/4"></div>
                    <div className="h-3 bg-surface-2 rounded w-1/4"></div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : notificationsData?.items?.length === 0 ? (
          <div className="text-center py-12">
            <Bell className="w-12 h-12 text-text-muted mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-2">No notifications</h3>
            <p className="text-text-muted">
              {filter === 'all' ? 'All caught up!' : `No ${filter.replace('type:', '')} notifications found.`}
            </p>
          </div>
        ) : (
          notificationsData?.items?.map((notification: NotificationItem) => (
            <div
              key={notification.id}
              className={`border-l-4 rounded-lg p-4 ${getTypeColor(notification.type)} ${
                !notification.read ? 'bg-opacity-100' : 'bg-opacity-50'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-start space-x-3 flex-grow">
                  {getTypeIcon(notification.type)}
                  
                  <div className="flex-grow min-w-0">
                    <div className="flex items-center space-x-2 mb-1">
                      <h3 className={`font-medium ${!notification.read ? 'text-text-strong' : 'text-text-muted'}`}>
                        {notification.title}
                      </h3>
                      {!notification.read && (
                        <div className="w-2 h-2 bg-primary rounded-full flex-shrink-0"></div>
                      )}
                    </div>
                    
                    <p className="text-sm text-text-muted mb-2">{notification.message}</p>
                    
                    <div className="flex items-center space-x-4 text-xs text-text-muted">
                      <span className="flex items-center space-x-1">
                        <Clock className="w-3 h-3" />
                        <span>{formatRelativeTime(notification.timestamp)}</span>
                      </span>
                      <span className="capitalize">{notification.priority} priority</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center space-x-2 flex-shrink-0 ml-4">
                  {!notification.read && (
                    <button
                      onClick={() => handleMarkAsRead(notification.id)}
                      disabled={operationLoading[`mark-read-${notification.id}`]}
                      className="text-xs text-primary hover:text-primary/90 transition-colors disabled:opacity-50"
                    >
                      {operationLoading[`mark-read-${notification.id}`] ? 'Marking...' : 'Mark Read'}
                    </button>
                  )}
                  <button
                    onClick={() => handleDismissNotification(notification.id)}
                    disabled={operationLoading[`dismiss-${notification.id}`]}
                    className="p-1 text-text-muted hover:text-danger transition-colors disabled:opacity-50"
                    title="Dismiss notification"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Pagination */}
      {notificationsData && Math.ceil(notificationsData.total / notificationsData.limit) > 1 && (
        <div className="bg-surface-1 rounded-lg border border-border px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="text-sm text-text-muted">
              Page {notificationsData.page} of {Math.ceil(notificationsData.total / notificationsData.limit)} 
              (showing {notificationsData.items.length} of {notificationsData.total} notifications)
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage <= 1 || loading}
                className="p-2 text-text-muted hover:text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Previous page"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage >= Math.ceil(notificationsData.total / notificationsData.limit) || loading}
                className="p-2 text-text-muted hover:text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Next page"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};