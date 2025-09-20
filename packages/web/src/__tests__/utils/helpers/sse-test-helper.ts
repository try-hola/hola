/**
 * Test helpers for SSE simulation with deterministic control.
 * Provides utilities to easily simulate SSE events in tests.
 */

import { act } from '@testing-library/react';
import { 
  ControllableEventSource, 
  eventSourceController, 
  SSEEventCreators 
} from '../mocks/controllable-eventsource';
import type { SSEEvent } from '@hola/shared';

// Factory function for creating controllable EventSource in tests
export const createControllableEventSourceFactory = () => {
  return (url: string) => new ControllableEventSource(url) as EventSource;
};

// Helper to wait for React state updates
const waitForStateUpdate = () => new Promise(resolve => setTimeout(resolve, 0));

/**
 * SSE test helper that provides controlled event simulation
 */
export class SSETestHelper {
  /**
   * Setup controllable EventSource for tests
   */
  static setup() {
    eventSourceController.reset();
    return createControllableEventSourceFactory();
  }

  /**
   * Cleanup after tests
   */
  static cleanup() {
    eventSourceController.reset();
  }

  /**
   * Simulate opening SSE connection
   */
  static async simulateOpen() {
    await act(async () => {
      eventSourceController.simulateOpenAll();
      await waitForStateUpdate();
    });
  }

  /**
   * Simulate SSE connection error
   */
  static async simulateError() {
    await act(async () => {
      eventSourceController.simulateErrorAll();
      await waitForStateUpdate();
    });
  }

  /**
   * Simulate SSE connection close
   */
  static async simulateClose() {
    await act(async () => {
      eventSourceController.simulateCloseAll();
      await waitForStateUpdate();
    });
  }

  /**
   * Send a log event
   */
  static async sendLogEvent(data: {
    timestamp?: string;
    service?: string;
    level?: string;
    message: string;
  }) {
    const eventData = SSEEventCreators.log(data);
    await act(async () => {
      eventSourceController.simulateMessageAll(eventData);
      await waitForStateUpdate();
    });
  }

  /**
   * Send a job update event
   */
  static async sendJobUpdateEvent(data: {
    jobId: string;
    status: string;
    progress?: number;
    finishedAt?: string;
  }) {
    const eventData = SSEEventCreators.jobUpdate(data);
    await act(async () => {
      eventSourceController.simulateMessageAll(eventData);
      await waitForStateUpdate();
    });
  }

  /**
   * Send a system update event
   */
  static async sendSystemUpdateEvent(data: Record<string, unknown>) {
    const eventData = SSEEventCreators.systemUpdate(data);
    await act(async () => {
      eventSourceController.simulateMessageAll(eventData);
      await waitForStateUpdate();
    });
  }

  /**
   * Send a deployment update event
   */
  static async sendDeploymentUpdateEvent(data: {
    deploymentId: string;
    status: string;
    uptime?: string;
    lastUpdated?: string;
  }) {
    const eventData = SSEEventCreators.deploymentUpdate(data);
    await act(async () => {
      eventSourceController.simulateMessageAll(eventData);
      await waitForStateUpdate();
    });
  }



  /**
   * Send a custom SSE event
   */
  static async sendCustomEvent(event: SSEEvent) {
    const eventData = JSON.stringify(event);
    await act(async () => {
      eventSourceController.simulateMessageAll(eventData);
      await waitForStateUpdate();
    });
  }

  /**
   * Get the current EventSource instances for inspection
   */
  static getInstances() {
    return eventSourceController.getInstances();
  }

  /**
   * Get the most recent EventSource instance
   */
  static getLastInstance() {
    return eventSourceController.getLastInstance();
  }

  /**
   * Simulate a complete SSE workflow: connect, send events, close
   */
  static async simulateWorkflow(events: SSEEvent[]) {
    // Open connection
    await this.simulateOpen();
    
    // Send events one by one
    for (const event of events) {
      await this.sendCustomEvent(event);
    }
    
    // Close connection
    await this.simulateClose();
  }

  /**
   * Create a sequence of log events for testing
   */
  static createLogEventSequence(count: number, baseMessage = 'Test log message'): SSEEvent[] {
    return Array.from({ length: count }, (_, i) => ({
      type: 'log' as const,
      data: {
        timestamp: new Date(Date.now() + i * 1000).toISOString(),
        service: 'test-service',
        level: 'info',
        message: `${baseMessage} ${i + 1}`,
      },
    }));
  }

  /**
   * Create a job progress sequence for testing
   */
  static createJobProgressSequence(jobId: string, steps = 5): SSEEvent[] {
    const statuses = ['pending', 'running', 'running', 'running', 'completed'];
    return Array.from({ length: steps }, (_, i) => ({
      type: 'job_update' as const,
      data: {
        jobId,
        status: statuses[i] || 'running',
        progress: Math.min(100, (i + 1) * 25),
        ...(i === steps - 1 && { finishedAt: new Date().toISOString() }),
      },
    }));
  }
}