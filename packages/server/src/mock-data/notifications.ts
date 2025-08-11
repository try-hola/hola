// Notifications mock data
import type {
  NotificationItem,
  GetNotificationsResponse,
  PatchNotificationResponse,
  PostNotificationsActionResponse,
  NotificationType,
  NotificationPriority
} from '@hola/shared';
import { stateManager } from './state-manager';

// Initialize with some default notifications
const initialNotifications = [
  {
    type: 'update' as NotificationType,
    title: 'Update Available: Nextcloud 28.0.3',
    message: 'Security improvements and bug fixes are available for your Nextcloud deployment.',
    read: false,
    priority: 'medium' as NotificationPriority,
  },
  {
    type: 'error' as NotificationType,
    title: 'Backup Failed: Plex Media Server',
    message: 'Insufficient disk space prevented the automatic backup from completing.',
    read: false,
    priority: 'high' as NotificationPriority,
  },
  {
    type: 'success' as NotificationType,
    title: 'Deployment Completed: Home Assistant',
    message: 'Your Home Assistant deployment has been successfully updated to version 2024.1.5.',
    read: true,
    priority: 'low' as NotificationPriority,
  },
  {
    type: 'warning' as NotificationType,
    title: 'High Resource Usage: Grafana',
    message: 'Grafana is consuming more CPU than usual. Consider reviewing your dashboard queries.',
    read: false,
    priority: 'medium' as NotificationPriority,
  },
  {
    type: 'info' as NotificationType,
    title: 'Scheduled Maintenance',
    message: 'System maintenance is scheduled for next Sunday at 2:00 AM UTC.',
    read: true,
    priority: 'low' as NotificationPriority,
  },
];

// Initialize state manager with notifications
for (const notification of initialNotifications) {
  stateManager.addNotification(notification);
}

function applyFilters(
  notifications: NotificationItem[],
  filter?: 'all' | 'unread' | `type:${NotificationType}`
): NotificationItem[] {
  if (!filter || filter === 'all') {
    return notifications;
  }

  if (filter === 'unread') {
    return notifications.filter(n => !n.read);
  }

  if (filter.startsWith('type:')) {
    const type = filter.substring(5) as NotificationType;
    return notifications.filter(n => n.type === type);
  }

  return notifications;
}

function paginateResults<T>(items: T[], page: number, limit: number): {
  items: T[];
  page: number;
  limit: number;
  total: number;
} {
  const total = items.length;
  const startIndex = (page - 1) * limit;
  const endIndex = startIndex + limit;
  const paginatedItems = items.slice(startIndex, endIndex);

  return {
    items: paginatedItems,
    page,
    limit,
    total,
  };
}

// Export functions for API handlers
export function getNotifications(params: {
  page?: number;
  limit?: number;
  filter?: 'all' | 'unread' | `type:${NotificationType}`;
}): GetNotificationsResponse {
  const { page = 1, limit = 10, filter } = params;
  
  const allNotifications = stateManager.getNotifications();
  const filteredNotifications = applyFilters(allNotifications, filter);
  const paginatedResult = paginateResults(filteredNotifications, page, limit);
  const unreadCount = stateManager.getUnreadNotificationCount();

  return {
    ...paginatedResult,
    unreadCount,
  };
}

export function updateNotification(
  notificationId: string,
  updates: { read?: boolean; dismiss?: boolean }
): PatchNotificationResponse | null {
  const notifications = stateManager.getNotifications();
  const notification = notifications.find(n => n.id === notificationId);
  
  if (!notification) {
    return null;
  }

  if (updates.read !== undefined) {
    if (updates.read) {
      stateManager.markNotificationRead(notificationId);
    }
    // Note: We don't support marking as unread in this mock
  }

  if (updates.dismiss) {
    // In a real system, this would remove the notification
    // For now, just mark as read
    stateManager.markNotificationRead(notificationId);
  }

  return {
    id: notificationId,
    read: true, // Since we always mark as read for now
  };
}

export function executeNotificationAction(
  action: 'markAllRead' | 'dismissAll'
): PostNotificationsActionResponse {
  switch (action) {
    case 'markAllRead':
      stateManager.markAllNotificationsRead();
      break;
    case 'dismissAll':
      // In a real system, this would clear all notifications
      // For now, just mark all as read
      stateManager.markAllNotificationsRead();
      break;
  }

  return { ok: true };
}

// Utility function to create notifications from system events
export function createSystemNotification(
  type: NotificationType,
  title: string,
  message: string,
  priority: NotificationPriority = 'medium'
): NotificationItem {
  return stateManager.addNotification({
    type,
    title,
    message,
    priority,
    read: false,
  });
}

// Function to generate notifications based on system events
export function generateJobNotifications(): void {
  const allJobs = stateManager.getAllJobs();
  
  // Check for newly completed jobs
  const recentlyCompleted = allJobs.filter(job => {
    if (job.status !== 'completed') return false;
    if (!job.finishedAt) return false;
    
    const finishedTime = new Date(job.finishedAt).getTime();
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    
    return finishedTime > fiveMinutesAgo;
  });

  // Check for newly failed jobs
  const recentlyFailed = allJobs.filter(job => {
    if (job.status !== 'failed') return false;
    if (!job.finishedAt) return false;
    
    const finishedTime = new Date(job.finishedAt).getTime();
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    
    return finishedTime > fiveMinutesAgo;
  });

  // Create success notifications for completed jobs
  for (const job of recentlyCompleted) {
    const deployment = job.deploymentId ? stateManager.getDeployment(job.deploymentId) : null;
    const appName = deployment?.name || 'Unknown App';
    
    createSystemNotification(
      'success',
      `${job.type} Completed: ${appName}`,
      `The ${job.type} operation for ${appName} has completed successfully.`,
      'low'
    );
  }

  // Create error notifications for failed jobs
  for (const job of recentlyFailed) {
    const deployment = job.deploymentId ? stateManager.getDeployment(job.deploymentId) : null;
    const appName = deployment?.name || 'Unknown App';
    
    createSystemNotification(
      'error',
      `${job.type} Failed: ${appName}`,
      `The ${job.type} operation for ${appName} has failed. Check the logs for more details.`,
      'high'
    );
  }
}
