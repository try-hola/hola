import React from 'react';
import { API } from '@hola/shared';
import { globalCache } from '../utils/cache';
import type { 
  GetNotificationsResponse,
  PatchNotificationRequest,
  PostNotificationsActionRequest,
  NotificationType
} from '@hola/shared';

/**
 * Hook for fetching notifications with filtering and pagination
 * Follows StrictMode-compatible patterns with parameterized requests
 */
export function useNotificationsApi(
  filter: 'all' | 'unread' | `type:${NotificationType}` = 'all',
  page: number = 1
) {
  const [state, setState] = React.useState<{
    data: GetNotificationsResponse | null;
    loading: boolean;
    error: string | null;
  }>({
    data: null,
    loading: false,
    error: null,
  });

  // Use useMemo for stable cache key based on params
  const cacheKey = React.useMemo(() => {
    return `notifications-${filter}-page-${page}`;
  }, [filter, page]);

  const fetchData = React.useCallback(async () => {
    const cached = globalCache.get<GetNotificationsResponse>(cacheKey);
    // Check cache first
    if (cached !== null) {
      setState({ data: cached, loading: false, error: null });
      return;
    }
    
    setState(prev => ({ ...prev, loading: true, error: null }));
    
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '10'
      });
      
      if (filter && filter !== 'all') {
        params.append('filter', filter);
      }

      const response = await fetch(`${API.notifications.base}?${params.toString()}`);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch notifications: ${response.status} ${response.statusText}`);
      }
      
      const result: GetNotificationsResponse = await response.json();
      globalCache.set<GetNotificationsResponse>(cacheKey, result);
      setState({ data: result, loading: false, error: null });
    } catch (error) {
      setState({
        data: null,
        loading: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }, [cacheKey, filter, page]); // Include params to refetch when they change

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Mark notification as read
  const markAsRead = React.useCallback(async (id: string) => {
    const request: PatchNotificationRequest = { read: true };
    const response = await fetch(API.notifications.byId(id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });
    
    if (!response.ok) {
      throw new Error(`Failed to mark notification as read: ${response.status} ${response.statusText}`);
    }
    
  // Invalidate cache and refetch
  globalCache.delete(cacheKey);
    await fetchData();
    
    return response.json();
  }, [cacheKey, fetchData]);

  // Dismiss notification
  const dismissNotification = React.useCallback(async (id: string) => {
    const request: PatchNotificationRequest = { dismiss: true };
    const response = await fetch(API.notifications.byId(id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });
    
    if (!response.ok) {
      throw new Error(`Failed to dismiss notification: ${response.status} ${response.statusText}`);
    }
    
  // Invalidate cache and refetch
  globalCache.delete(cacheKey);
    await fetchData();
    
    return response.json();
  }, [cacheKey, fetchData]);

  // Mark all as read
  const markAllAsRead = React.useCallback(async () => {
    const request: PostNotificationsActionRequest = { action: 'markAllRead' };
    const response = await fetch(API.notifications.actions, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });
    
    if (!response.ok) {
      throw new Error(`Failed to mark all notifications as read: ${response.status} ${response.statusText}`);
    }
    
    // Invalidate notification caches and refetch
    globalCache.deleteByPattern(/^notifications-/);
    await fetchData();
    
    return response.json();
  }, [fetchData]);

  // Dismiss all notifications
  const dismissAll = React.useCallback(async () => {
    const request: PostNotificationsActionRequest = { action: 'dismissAll' };
    const response = await fetch(API.notifications.actions, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });
    
    if (!response.ok) {
      throw new Error(`Failed to dismiss all notifications: ${response.status} ${response.statusText}`);
    }
    
    // Invalidate notification caches and refetch
    globalCache.deleteByPattern(/^notifications-/);
    await fetchData();
    
    return response.json();
  }, [fetchData]);

  return { 
    ...state, 
    refetch: fetchData,
    markAsRead,
    dismissNotification,
    markAllAsRead,
    dismissAll
  };
}
