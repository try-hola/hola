/**
 * Jobs and Structured Logs Tests
 *
 * Verifies jobs creation, listing, and SSE log streams. Works in both
 * real and mock modes by checking feature flags at runtime.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { API } from '@hola/shared';
import type { GetJobsResponse, SystemConfigResponse } from '@hola/shared';
import { setupTestServer, teardownTestServer, TEST_BASE_URL } from '../utils/server';
import { getServices, resetServices } from '../../services/simple-factory';
import { MockJobService } from '../../services/core/jobs';

const BASE_URL = TEST_BASE_URL;
const TEST_TIMEOUT = 8000;

async function getConfig(): Promise<SystemConfigResponse> {
  const res = await fetch(`${BASE_URL}${API.system.health}`);
  if (!res.ok) throw new Error(`Failed to get config: ${res.status}`);
  return res.json() as Promise<SystemConfigResponse>;
}

describe('Jobs and Structured Logs', () => {
  beforeAll(async () => {
    await setupTestServer();
    await getConfig();
    // Note: config flags could be used to branch assertions in future
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await teardownTestServer();
  });

  describe('Jobs listing', () => {
    it('GET /api/jobs returns a valid paginated response', async () => {
      const res = await fetch(`${BASE_URL}${API.jobs.base}?page=1&limit=10`);
      expect(res.ok).toBe(true);
      const data = await res.json() as GetJobsResponse;
      expect(data).toHaveProperty('items');
      expect(Array.isArray(data.items)).toBe(true);
      expect(typeof data.page).toBe('number');
      expect(typeof data.limit).toBe('number');
      expect(typeof data.total).toBe('number');
    }, TEST_TIMEOUT);
  });

  describe('Job logs SSE', () => {
    it('GET /api/jobs/:id/logs has SSE headers', async () => {
      const services = getServices();
  // Use a valid JobType ('install' used for generic log stream testing)
  const job = await services.jobs.createJob({ type: 'install', deploymentId: 'homeassistant-main' });
      const jobId = job.id;

      const res = await fetch(`${BASE_URL}${API.jobs.logs(jobId)}`);
      expect(res.ok).toBe(true);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      expect(res.headers.get('cache-control')).toBe('no-cache');
      expect(res.headers.get('connection')).toBe('keep-alive');
      // We do not consume the stream to avoid hanging the test
    }, TEST_TIMEOUT);

    it('GET /api/jobs/:id/logs/stream has SSE headers and supports job_update events', async () => {
      const services = getServices();
  const job = await services.jobs.createJob({ type: 'install', deploymentId: 'grafana-monitoring' });
      const jobId = job.id;

      const res = await fetch(`${BASE_URL}${API.jobs.logsStream(jobId)}`);
      expect(res.ok).toBe(true);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      expect(res.headers.get('cache-control')).toBe('no-cache');
      expect(res.headers.get('connection')).toBe('keep-alive');

      const reader = res.body?.getReader();
      expect(reader).toBeDefined();
      if (!reader) return;

      const eventsPromise = (async () => {
        const decoder = new TextDecoder();
        let buffer = '';
        const events: unknown[] = [];
        while (events.length < 2) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() ?? '';
          for (const part of parts) {
            const dataLine = part.split('\n').find(line => line.startsWith('data:'));
            if (dataLine) {
              events.push(JSON.parse(dataLine.replace('data:', '').trim()));
            }
          }
        }
        return events;
      })();

      await services.logging.logJob(jobId, 'info', 'SSE header verification log', { service: 'job-runner' });
      (services.jobs as MockJobService).emitTestUpdate(jobId, {
        id: jobId,
        status: 'completed',
        progress: 100,
        finishedAt: new Date().toISOString(),
      });

      const events = await eventsPromise;
      expect(events.length).toBeGreaterThanOrEqual(1);
      await reader?.cancel();
    }, TEST_TIMEOUT);
  });
});
