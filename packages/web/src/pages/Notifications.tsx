import React, { useState } from 'react';
import { Bell, X, Clock, AlertTriangle, CheckCircle, Info } from 'lucide-react';

const notifications = [
  {
    id: '1',
    type: 'update',
    title: 'Update Available: Nextcloud 28.0.3',
    message: 'A new version of Nextcloud is available with security improvements.',
    timestamp: '2 hours ago',
    read: false,
    priority: 'medium',
  },
  {
    id: '2',
    type: 'error',
    title: 'Backup Failed: Plex Media Server',
    message: 'Backup failed due to insufficient disk space. Please free up space and retry.',
    timestamp: '4 hours ago',
    read: false,
    priority: 'high',
  },
  {
    id: '3',
    type: 'success',
    title: 'Installation Complete: Grafana',
    message: 'Grafana has been successfully installed and is now running.',
    timestamp: '1 day ago',
    read: true,
    priority: 'low',
  },
  {
    id: '4',
    type: 'info',
    title: 'Scheduled Maintenance',
    message: 'System backup will run tonight at 2:00 AM. No action required.',
    timestamp: '2 days ago',
    read: true,
    priority: 'low',
  },
  {
    id: '5',
    type: 'warning',
    title: 'Low Disk Space Warning',
    message: 'Available disk space is below 10%. Consider cleaning up old backups.',
    timestamp: '3 days ago',
    read: false,
    priority: 'medium',
  },
];

const getTypeIcon = (type: string) => {
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

const getTypeColor = (type: string) => {
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

export const Notifications: React.FC = () => {
  const [filter, setFilter] = useState('all');
  const [notificationList, setNotificationList] = useState(notifications);

  const filteredNotifications = notificationList.filter(notification => {
    if (filter === 'unread') return !notification.read;
    if (filter === 'read') return notification.read;
    if (filter !== 'all') return notification.type === filter;
    return true;
  });

  const unreadCount = notificationList.filter(n => !n.read).length;

  const markAsRead = (id: string) => {
    setNotificationList(notifications =>
      notifications.map(n =>
        n.id === id ? { ...n, read: true } : n
      )
    );
  };

  const dismissNotification = (id: string) => {
    setNotificationList(notifications =>
      notifications.filter(n => n.id !== id)
    );
  };

  const dismissAll = () => {
    setNotificationList([]);
  };

  const markAllAsRead = () => {
    setNotificationList(notifications =>
      notifications.map(n => ({ ...n, read: true }))
    );
  };

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
              onClick={markAllAsRead}
              className="px-4 py-2 bg-surface-1 border border-border rounded-lg text-sm font-medium hover:bg-surface-2 transition-colors"
            >
              Mark All Read
            </button>
          )}
          <button
            onClick={dismissAll}
            className="px-4 py-2 bg-surface-1 border border-border rounded-lg text-sm font-medium hover:bg-surface-2 transition-colors"
          >
            Dismiss All
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {[
          { key: 'all', label: 'All' },
          { key: 'unread', label: 'Unread' },
          { key: 'error', label: 'Errors' },
          { key: 'warning', label: 'Warnings' },
          { key: 'update', label: 'Updates' },
          { key: 'success', label: 'Success' },
          { key: 'info', label: 'Info' },
        ].map(filterOption => (
          <button
            key={filterOption.key}
            onClick={() => setFilter(filterOption.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
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
        {filteredNotifications.length === 0 ? (
          <div className="text-center py-12">
            <Bell className="w-12 h-12 text-text-muted mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-2">No notifications</h3>
            <p className="text-text-muted">
              {filter === 'all' ? 'All caught up!' : `No ${filter} notifications found.`}
            </p>
          </div>
        ) : (
          filteredNotifications.map(notification => (
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
                        <span>{notification.timestamp}</span>
                      </span>
                      <span className="capitalize">{notification.priority} priority</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center space-x-2 flex-shrink-0 ml-4">
                  {!notification.read && (
                    <button
                      onClick={() => markAsRead(notification.id)}
                      className="text-xs text-primary hover:text-primary/90 transition-colors"
                    >
                      Mark Read
                    </button>
                  )}
                  <button
                    onClick={() => dismissNotification(notification.id)}
                    className="p-1 text-text-muted hover:text-danger transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};