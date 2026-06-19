import React, { useState, useCallback } from 'react';
import {
  Bell,
  X,
  Check,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Info,
  Trash2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import type {
  NotificationItem,
  NotificationType
} from '@hola/shared';
import { useNotificationsApi } from '../hooks/useNotificationsApi';

// Helper functions
const getTypeIcon = (type: NotificationType) => {
  switch (type) {
    case 'error':
      return <XCircle className="w-[18px] h-[18px]" />;
    case 'success':
      return <CheckCircle2 className="w-[18px] h-[18px]" />;
    case 'warning':
      return <AlertTriangle className="w-[18px] h-[18px]" />;
    case 'info':
      return <Info className="w-[18px] h-[18px]" />;
    case 'update':
      return <Bell className="w-[18px] h-[18px]" />;
    default:
      return <Bell className="w-[18px] h-[18px]" />;
  }
};

// Severity chip: tinted bg + colored icon, mapped by type.
const getChipClasses = (type: NotificationType) => {
  switch (type) {
    case 'error':
      return 'bg-danger-weak text-danger';
    case 'success':
      return 'bg-success-weak text-success';
    case 'warning':
      return 'bg-warning-weak text-warning';
    case 'info':
      return 'bg-primary-weak text-info';
    case 'update':
      return 'bg-primary-weak text-primary';
    default:
      return 'bg-surface-2 text-text-muted';
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
  const items = notificationsData?.items ?? [];

  const filterOptions = [
    { key: 'all' as const, label: 'All' },
    { key: 'unread' as const, label: 'Unread' },
    { key: 'type:info' as const, label: 'Info' },
    { key: 'type:success' as const, label: 'Success' },
    { key: 'type:warning' as const, label: 'Warning' },
    { key: 'type:error' as const, label: 'Error' },
    { key: 'type:update' as const, label: 'Updates' },
  ];

  return (
    <div className="animate-fadein max-w-[820px]">
      {/* Header */}
      <div className="flex items-end gap-3.5 mb-[18px] flex-wrap">
        <div>
          <h1 className="m-0 text-2xl font-semibold tracking-[-0.02em]">Notifications</h1>
          <p className="mt-1.5 text-text-muted text-sm">System events across your server.</p>
        </div>
        <div className="flex-1" />
        {unreadCount > 0 && (
          <button
            onClick={handleMarkAllAsRead}
            disabled={operationLoading['mark-all-read']}
            className="h-[38px] px-[14px] flex items-center gap-[7px] bg-surface-1 text-text-strong border border-border rounded-[9px] text-[13.5px] font-semibold hover:border-primary transition-colors disabled:opacity-50"
          >
            <Check className="w-4 h-4" />
            {operationLoading['mark-all-read'] ? 'Marking…' : 'Mark all read'}
          </button>
        )}
        {items.length > 0 && (
          <button
            onClick={handleDismissAll}
            disabled={operationLoading['dismiss-all']}
            className="h-[38px] px-[14px] flex items-center gap-[7px] bg-surface-1 text-text-muted border border-border rounded-[9px] text-[13.5px] font-semibold hover:border-danger hover:text-danger transition-colors disabled:opacity-50"
          >
            <Trash2 className="w-4 h-4" />
            {operationLoading['dismiss-all'] ? 'Dismissing…' : 'Dismiss all'}
          </button>
        )}
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-danger-weak border border-danger/20 text-danger rounded-card p-4 text-sm flex items-center gap-2 mb-4">
          <AlertTriangle className="w-4 h-4 flex-none" />
          <span className="flex-1">{error}</span>
          <button
            onClick={() => refetch()}
            className="p-1 hover:bg-danger/20 rounded transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Segmented filter */}
      <div className="flex gap-[3px] p-[3px] bg-surface-1 border border-border rounded-[9px] w-max mb-4">
        {filterOptions.map((filterOption) => {
          const active = filter === filterOption.key;
          return (
            <button
              key={filterOption.key}
              onClick={() => handleFilterChange(filterOption.key)}
              disabled={loading}
              className={`h-[30px] px-[14px] flex items-center rounded-[7px] text-[13px] font-medium cursor-pointer disabled:opacity-50 transition-colors ${
                active
                  ? 'bg-primary-weak text-primary'
                  : 'text-text-muted hover:text-text-strong'
              }`}
            >
              {filterOption.label}
            </button>
          );
        })}
      </div>

      {/* List card */}
      <div className="bg-surface-1 border border-border rounded-card overflow-hidden">
        {loading && items.length === 0 ? (
          [...Array(5)].map((_, i) => (
            <div
              key={i}
              className="flex items-start gap-[14px] px-[18px] py-[15px] border-b border-border-soft animate-pulse"
            >
              <div className="w-[34px] h-[34px] flex-none rounded-[9px] bg-surface-2" />
              <div className="flex-1 min-w-0 space-y-2">
                <div className="h-3.5 bg-surface-2 rounded w-1/3" />
                <div className="h-3 bg-surface-2 rounded w-3/4" />
              </div>
            </div>
          ))
        ) : items.length === 0 ? (
          <div className="px-12 py-[60px] text-center text-text-muted text-sm">
            Nothing here — you’re all caught up.
          </div>
        ) : (
          items.map((notification: NotificationItem) => (
            <div
              key={notification.id}
              onClick={() =>
                !notification.read &&
                !operationLoading[`mark-read-${notification.id}`] &&
                handleMarkAsRead(notification.id)
              }
              className="flex items-start gap-[14px] px-[18px] py-[15px] border-b border-border-soft cursor-pointer hover:bg-surface-2 transition-colors"
              style={notification.read ? undefined : { background: 'rgba(91,140,255,.05)' }}
            >
              <span
                className={`w-[34px] h-[34px] flex-none rounded-[9px] flex items-center justify-center ${getChipClasses(
                  notification.type,
                )}`}
              >
                {getTypeIcon(notification.type)}
              </span>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13.5px] font-semibold">{notification.title}</span>
                  {!notification.read && (
                    <span className="w-[7px] h-[7px] flex-none rounded-full bg-primary" />
                  )}
                </div>
                <div className="text-[12.5px] text-text-muted mt-[3px]">{notification.message}</div>
              </div>

              <span className="text-xs text-text-faint flex-none whitespace-nowrap">
                {formatRelativeTime(notification.timestamp)}
              </span>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDismissNotification(notification.id);
                }}
                disabled={operationLoading[`dismiss-${notification.id}`]}
                className="flex-none p-1 text-text-faint hover:text-danger transition-colors disabled:opacity-50"
                title="Dismiss notification"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))
        )}
      </div>

      {/* Pagination */}
      {notificationsData && Math.ceil(notificationsData.total / notificationsData.limit) > 1 && (
        <div className="flex items-center justify-between mt-4 px-[18px] py-[13px] bg-surface-1 border border-border rounded-card">
          <div className="text-[13px] text-text-muted">
            Page {notificationsData.page} of {Math.ceil(notificationsData.total / notificationsData.limit)} ·
            showing {notificationsData.items.length} of {notificationsData.total}
          </div>
          <div className="flex items-center gap-2">
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
      )}
    </div>
  );
};