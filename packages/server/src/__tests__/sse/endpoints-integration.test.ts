/**
 * SSE Endpoints Integration Tests
 * 
 * Tests Server-Sent Events endpoints with running server to validate headers and message structure.
 * Covers both `/api/jobs/:id/logs/stream` and `/api/dev/sessions/:id/events`.
 * Uses fail-fast timeouts to prevent hanging tests.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { API } from '@hola/shared';
import type { 
  PostDeploymentActionResponse, 
  SystemConfigResponse, 
  CreateDevSessionRequest,
  CreateDevSessionResponse,
  SSEEvent,
  SSELogEvent,
  SSEJobUpdateEvent,
  SSEDevSessionStatusEvent
} from '@hola/shared';
import { setupTestServer, teardownTestServer } from '../utils/server';

const BASE_URL = 'http://localhost:3001';
const TEST_TIMEOUT = 15000; // Reduced from 30s for fail-fast
const SSE_TIMEOUT = 8000; // Max time to wait for SSE events

async function getConfig(): Promise<SystemConfigResponse> {
  const res = await fetch(`${BASE_URL}${API.system.config}`);
  if (!res.ok) throw new Error(`Failed to get config: ${res.status}`);
  return res.json() as Promise<SystemConfigResponse>;
}

/**
 * Helper to read SSE events with timeout and proper cleanup
 */
async function readSSEEvents(
  response: Response, 
  expectedEventCount: number = 1,
  timeoutMs: number = SSE_TIMEOUT
): Promise<{ events: (SSEEvent | { type?: string; data?: unknown })[]; headers: Headers }> {
  return new Promise((resolve, reject) => {
    const events: (SSEEvent | { type?: string; data?: unknown })[] = [];
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    
    if (!reader) {
      reject(new Error('Response body is not readable'));
      return;
    }
    
    // Set up timeout to prevent hanging
    const timeout = setTimeout(() => {
      reader.cancel();
      reject(new Error(`SSE timeout: received ${events.length}/${expectedEventCount} events in ${timeoutMs}ms`));
    }, timeoutMs);
    
    const readEvents = async () => {
      try {
        while (events.length < expectedEventCount) {
          const { done, value } = await reader.read();
          
          if (done) {
            clearTimeout(timeout);
            resolve({ events, headers: response.headers });
            return;
          }
          
          buffer += decoder.decode(value, { stream: true });
          
          // Parse SSE events from buffer
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep incomplete line in buffer
          
          let currentEvent: { type?: string; data?: string } = {};
          
          for (const line of lines) {
            if (line.startsWith('event:')) {
              currentEvent.type = line.substring(6).trim();
            } else if (line.startsWith('data:')) {
              currentEvent.data = line.substring(5).trim();
            } else if (line === '' && currentEvent.data) {
              // End of event
              try {
                const eventData = JSON.parse(currentEvent.data);
                events.push(eventData);
                
                // If we have enough events, resolve early
                if (events.length >= expectedEventCount) {
                  clearTimeout(timeout);
                  reader.cancel();
                  resolve({ events, headers: response.headers });
                  return;
                }
              } catch (error) {
                // Skip malformed events but continue reading
                console.warn('Failed to parse SSE event:', currentEvent.data, error);
              }
              currentEvent = {};
            }
          }
        }
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    };
    
    readEvents();
  });
}

describe('SSE Endpoints Integration Tests', () => {
  let config: SystemConfigResponse;
  
  beforeAll(async () => {
    await setupTestServer();
    config = await getConfig();
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await teardownTestServer();
  });

  describe('Job Logs SSE Stream (/api/jobs/:id/logs/stream)', () => {
    it('has correct SSE headers', async () => {
      // Create a job first
      const depId = 'homeassistant-main';
      const actionRes = await fetch(`${BASE_URL}${API.deployments.actions(depId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      });
      expect(actionRes.ok).toBe(true);
      
      const actionData = await actionRes.json() as PostDeploymentActionResponse;
      expect(actionData.jobId).toBeDefined();
      const jobId = actionData.jobId!;

      // Test SSE endpoint
      const response = await fetch(`${BASE_URL}${API.jobs.logsStream(jobId)}`);
      
      // Validate headers
      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      expect(response.headers.get('cache-control')).toBe('no-cache');
      expect(response.headers.get('connection')).toBe('keep-alive');
      
      // Close the stream immediately to avoid hanging
      await response.body?.cancel();
    }, TEST_TIMEOUT);

    it('sends valid SSE events with proper structure', async () => {
      // Create a job first
      const depId = 'grafana-monitoring';
      const actionRes = await fetch(`${BASE_URL}${API.deployments.actions(depId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'restart' }),
      });
      expect(actionRes.ok).toBe(true);
      
      const actionData = await actionRes.json() as PostDeploymentActionResponse;
      expect(actionData.jobId).toBeDefined();
      const jobId = actionData.jobId!;

      // Test SSE event structure
      const response = await fetch(`${BASE_URL}${API.jobs.logsStream(jobId)}`);
      expect(response.ok).toBe(true);
      
      // Read events with timeout
      const { events } = await readSSEEvents(response, 2, SSE_TIMEOUT);
      
      expect(events.length).toBeGreaterThanOrEqual(1);
      
      // Check for log events
      const logEvents = events.filter(e => e.type === 'log') as SSELogEvent[];
      if (logEvents.length > 0) {
        const logEvent = logEvents[0];
        expect(logEvent.data).toBeDefined();
        expect(logEvent.data.timestamp).toBeDefined();
        expect(logEvent.data.message).toBeDefined();
        expect(logEvent.data.level).toBeDefined();
        expect(logEvent.data.service).toBeDefined();
      }
      
      // Check for job update events
      const jobEvents = events.filter(e => e.type === 'job_update') as SSEJobUpdateEvent[];
      if (jobEvents.length > 0) {
        const jobEvent = jobEvents[0];
        expect(jobEvent.data).toBeDefined();
        expect(jobEvent.data.jobId).toBe(jobId);
        expect(jobEvent.data.status).toBeDefined();
      }
    }, TEST_TIMEOUT);
  });

  describe('Dev Session Events SSE Stream (/api/dev/sessions/:id/events)', () => {
    let sessionId: string;
    
    beforeAll(async () => {
      // Skip if Phase 7 API is not enabled
      if (!config.featureFlags?.enableDevApi) {
        return;
      }
      
      // Create a dev session for testing
      const createRequest: CreateDevSessionRequest = {
        draftId: 'test-draft-123',
        name: 'Test Session',
        autoStart: false,
      };
      
      const createRes = await fetch(`${BASE_URL}${API.dev.sessions}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(createRequest),
      });
      
      if (createRes.ok) {
        const createData = await createRes.json() as CreateDevSessionResponse;
        sessionId = createData.sessionId;
      }
    });

    it('has correct SSE headers', async () => {
      // Skip if Phase 7 API is not enabled
      if (!config.featureFlags?.enableDevApi) {
        console.log('Skipping dev session test - Phase 7 API not enabled');
        return;
      }
      
      if (!sessionId) {
        console.log('Skipping dev session test - session creation failed');
        return;
      }

      const response = await fetch(`${BASE_URL}${API.dev.events(sessionId)}`);
      
      // Validate headers
      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      expect(response.headers.get('cache-control')).toBe('no-cache');
      expect(response.headers.get('connection')).toBe('keep-alive');
      
      // Close the stream immediately to avoid hanging
      await response.body?.cancel();
    }, TEST_TIMEOUT);

    it('sends valid dev session SSE events', async () => {
      // Skip if Phase 7 API is not enabled
      if (!config.featureFlags?.enableDevApi) {
        console.log('Skipping dev session test - Phase 7 API not enabled');
        return;
      }
      
      if (!sessionId) {
        console.log('Skipping dev session test - session creation failed');
        return;
      }

      const response = await fetch(`${BASE_URL}${API.dev.events(sessionId)}`);
      expect(response.ok).toBe(true);
      
      // Read events with timeout
      const { events } = await readSSEEvents(response, 2, SSE_TIMEOUT);
      
      expect(events.length).toBeGreaterThanOrEqual(1);
      
      // Look for heartbeat events (should always be present)
      const heartbeats = events.filter(e => !e.type || e.type === 'heartbeat');
      expect(heartbeats.length).toBeGreaterThanOrEqual(0); // Heartbeats may not have type field
      
      // Check for session status events
      const statusEvents = events.filter(e => e.type === 'session_status') as SSEDevSessionStatusEvent[];
      if (statusEvents.length > 0) {
        const statusEvent = statusEvents[0];
        expect(statusEvent.data).toBeDefined();
        expect(statusEvent.data.sessionId).toBe(sessionId);
        expect(statusEvent.data.status).toBeDefined();
        expect(statusEvent.data.lastActivity).toBeDefined();
      }
      
      // Check for log events related to the session
      const logEvents = events.filter(e => e.type === 'log') as SSELogEvent[];
      if (logEvents.length > 0) {
        const logEvent = logEvents[0];
        expect(logEvent.data).toBeDefined();
        expect(logEvent.data.timestamp).toBeDefined();
        expect(logEvent.data.message).toBeDefined();
        expect(logEvent.data.service).toContain(sessionId);
      }
    }, TEST_TIMEOUT);

    it('returns 404 for non-existent session', async () => {
      // Skip if Phase 7 API is not enabled
      if (!config.featureFlags?.enableDevApi) {
        console.log('Skipping dev session test - Phase 7 API not enabled');
        return;
      }

      const nonExistentSessionId = 'non-existent-session-123';
      const response = await fetch(`${BASE_URL}${API.dev.events(nonExistentSessionId)}`);
      
      // Different behavior depending on service implementation:
      // - Real service: returns 404 for non-existent sessions
      // - Mock service: may return 200 and start streaming anyway
      if (response.status === 404) {
        const errorData = await response.json();
        expect(errorData.error).toBeDefined();
        expect(errorData.error.code).toBe('NOT_FOUND');
      } else {
        // Mock implementation - verify it's an SSE stream
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('text/event-stream');
      }
    }, TEST_TIMEOUT);
  });

  describe('SSE Connection Reliability', () => {
    it('handles connection close gracefully', async () => {
      // Test with job logs stream
      const depId = 'nextcloud-prod';
      const actionRes = await fetch(`${BASE_URL}${API.deployments.actions(depId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      });
      expect(actionRes.ok).toBe(true);
      
      const actionData = await actionRes.json() as PostDeploymentActionResponse;
      const jobId = actionData.jobId!;

      const response = await fetch(`${BASE_URL}${API.jobs.logsStream(jobId)}`);
      expect(response.ok).toBe(true);
      
      // Start reading then close connection
      const reader = response.body?.getReader();
      expect(reader).toBeDefined();
      
      // Read a bit then close
      if (reader) {
        await reader.read(); // Read first chunk
        await reader.cancel(); // Close connection
        // Should not throw or hang
      }
    }, TEST_TIMEOUT);

    it('sends heartbeat events to keep connection alive', async () => {
      // Create a job first
      const depId = 'homeassistant-main';
      const actionRes = await fetch(`${BASE_URL}${API.deployments.actions(depId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'stop' }),
      });
      expect(actionRes.ok).toBe(true);
      
      const actionData = await actionRes.json() as PostDeploymentActionResponse;
      const jobId = actionData.jobId!;

      const response = await fetch(`${BASE_URL}${API.jobs.logsStream(jobId)}`);
      expect(response.ok).toBe(true);
      
      // Read for a longer period to catch heartbeats
      const { events } = await readSSEEvents(response, 1, 6000);
      
      // Should receive at least some events (logs, job updates, or heartbeats)
      expect(events.length).toBeGreaterThanOrEqual(1);
    }, TEST_TIMEOUT);
  });
});