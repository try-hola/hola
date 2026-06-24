import React from 'react';
import { globalCache } from '../utils/cache';

/**
 * Types for optimistic update operations
 */
export interface OptimisticUpdate<T> {
  id: string;
  type: 'create' | 'update' | 'delete';
  data: T;
  originalData?: T;
  cacheKey: string;
  timestamp: number;
}

export interface OptimisticUpdateOptions {
  // Automatically rollback after timeout if server hasn't confirmed
  rollbackTimeout?: number;
  // Custom rollback function
  onRollback?: () => void;
  // Custom error handler
  onError?: (error: Error) => void;
}

/**
 * Hook for managing optimistic updates with automatic rollback
 * Provides immediate UI feedback while waiting for server confirmation
 */
export function useOptimisticUpdates<T>() {
  const [pendingUpdates, setPendingUpdates] = React.useState<Map<string, OptimisticUpdate<T>>>(
    () => new Map()
  );

  // Rollback a specific optimistic update
  const rollbackUpdate = React.useCallback((updateId: string) => {
    setPendingUpdates(prev => {
      const update = prev.get(updateId);
      if (!update) return prev;

      // Restore original data to cache
      if (update.originalData !== undefined) {
        globalCache.set(update.cacheKey, update.originalData);
      } else {
        globalCache.delete(update.cacheKey);
      }

      // Remove from pending updates
      const next = new Map(prev);
      next.delete(updateId);
      return next;
    });
  }, []);

  // Apply optimistic update to cache and track for potential rollback
  const applyOptimisticUpdate = React.useCallback(
    async <TResult>(
      cacheKey: string,
      updateFn: (current: T | null) => T,
      serverAction: () => Promise<TResult>,
      options: OptimisticUpdateOptions = {}
    ): Promise<TResult> => {
      const updateId = `${cacheKey}-${Date.now()}`;
      const originalData = globalCache.get<T>(cacheKey);
      
      try {
        // Apply optimistic update to cache
        const optimisticData = updateFn(originalData);
        globalCache.set(cacheKey, optimisticData);

        // Track the update for potential rollback
        const update: OptimisticUpdate<T> = {
          id: updateId,
          type: originalData ? 'update' : 'create',
          data: optimisticData,
          originalData: originalData ?? undefined,
          cacheKey,
          timestamp: Date.now(),
        };

        setPendingUpdates(prev => new Map(prev.set(updateId, update)));

        // Set up rollback timeout if specified
        let rollbackTimer: number | undefined;
        if (options.rollbackTimeout) {
          rollbackTimer = setTimeout(() => {
            rollbackUpdate(updateId);
            options.onRollback?.();
          }, options.rollbackTimeout);
        }

        // Execute server action
        const result = await serverAction();

        // Clear rollback timer on success
        if (rollbackTimer) {
          clearTimeout(rollbackTimer);
        }

        // The rollback timer may have already fired and reverted the cache while a
        // slow-but-successful action was still in flight. The action succeeded, so
        // re-assert the updated value rather than leave the cache showing the
        // rolled-back (pre-update) state, which would diverge from the server.
        globalCache.set(cacheKey, optimisticData);

        // Remove from pending updates on success
        setPendingUpdates(prev => {
          const next = new Map(prev);
          next.delete(updateId);
          return next;
        });

        return result;
      } catch (error) {
        // Rollback optimistic update on error
        rollbackUpdate(updateId);
        
        // Call error handler if provided
        if (options.onError) {
          options.onError(error as Error);
        } else {
          throw error;
        }
        
        throw error;
      }
    },
    [rollbackUpdate]
  );

  // Rollback all pending updates (e.g., on component unmount or error)
  const rollbackAll = React.useCallback(() => {
    for (const [updateId] of pendingUpdates) {
      rollbackUpdate(updateId);
    }
  }, [pendingUpdates, rollbackUpdate]);

  // Confirm an update (remove from pending without rollback)
  const confirmUpdate = React.useCallback((updateId: string) => {
    setPendingUpdates(prev => {
      const next = new Map(prev);
      next.delete(updateId);
      return next;
    });
  }, []);

  // Get current pending updates
  const getPendingUpdates = React.useCallback(() => {
    return Array.from(pendingUpdates.values());
  }, [pendingUpdates]);

  // Check if a cache key has pending updates
  const hasPendingUpdates = React.useCallback((cacheKey: string) => {
    return Array.from(pendingUpdates.values()).some(update => update.cacheKey === cacheKey);
  }, [pendingUpdates]);

  return {
    applyOptimisticUpdate,
    rollbackUpdate,
    rollbackAll,
    confirmUpdate,
    getPendingUpdates,
    hasPendingUpdates,
    pendingCount: pendingUpdates.size,
  };
}

/**
 * Convenience hooks for common optimistic update patterns
 */

// Optimistic list operations (add, remove, update items)
export function useOptimisticList<T extends { id: string }>() {
  const optimistic = useOptimisticUpdates<T[]>();

  const addItem = React.useCallback(
    (cacheKey: string, newItem: T, serverAction: () => Promise<T>) => {
      return optimistic.applyOptimisticUpdate(
        cacheKey,
        (currentList) => {
          const list = currentList || [];
          return [newItem, ...list];
        },
        serverAction,
        { rollbackTimeout: 30000 }
      );
    },
    [optimistic]
  );

  const updateItem = React.useCallback(
    (cacheKey: string, itemId: string, updates: Partial<T>, serverAction: () => Promise<T>) => {
      return optimistic.applyOptimisticUpdate(
        cacheKey,
        (currentList) => {
          const list = currentList || [];
          return list.map(item => 
            item.id === itemId ? { ...item, ...updates } : item
          );
        },
        serverAction,
        { rollbackTimeout: 30000 }
      );
    },
    [optimistic]
  );

  const removeItem = React.useCallback(
    (cacheKey: string, itemId: string, serverAction: () => Promise<void>) => {
      return optimistic.applyOptimisticUpdate(
        cacheKey,
        (currentList) => {
          const list = currentList || [];
          return list.filter(item => item.id !== itemId);
        },
        serverAction,
        { rollbackTimeout: 30000 }
      );
    },
    [optimistic]
  );

  return {
    ...optimistic,
    addItem,
    updateItem,
    removeItem,
  };
}

// Optimistic entity operations (for single objects)
export function useOptimisticEntity<T>() {
  const optimistic = useOptimisticUpdates<T>();

  const updateEntity = React.useCallback(
    (cacheKey: string, updates: Partial<T>, serverAction: () => Promise<T>) => {
      return optimistic.applyOptimisticUpdate(
        cacheKey,
        (current) => {
          if (!current) throw new Error('Cannot update non-existent entity');
          return { ...current, ...updates };
        },
        serverAction,
        { rollbackTimeout: 30000 }
      );
    },
    [optimistic]
  );

  const replaceEntity = React.useCallback(
    (cacheKey: string, newEntity: T, serverAction: () => Promise<T>) => {
      return optimistic.applyOptimisticUpdate(
        cacheKey,
        () => newEntity,
        serverAction,
        { rollbackTimeout: 30000 }
      );
    },
    [optimistic]
  );

  return {
    ...optimistic,
    updateEntity,
    replaceEntity,
  };
}
