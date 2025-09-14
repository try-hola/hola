import { describe, it, expect } from 'vitest';
import {
  createHealthResponseFixture,
  createSummaryResponseFixture,
  createJobFixture,
  createGetCatalogAppsResponseFixture,
  createJobFixtures,
  createApiErrorResponse
} from './fixtures';

describe('Test Fixtures', () => {
  it('should create valid health response fixture', () => {
    const health = createHealthResponseFixture();
    expect(health.ok).toBe(true);
    expect(health.ts).toBeDefined();
    expect(typeof health.ts).toBe('string');
  });

  it('should create valid health response with overrides', () => {
    const health = createHealthResponseFixture({ ok: false });
    expect(health.ok).toBe(false);
    expect(health.ts).toBeDefined();
  });

  it('should create valid summary response fixture', () => {
    const summary = createSummaryResponseFixture();
    expect(summary.deploymentsCount).toBe(3);
    expect(summary.activeJobsCount).toBe(1);
    expect(summary.alertsCount).toBe(0);
    expect(summary.recentJobs).toHaveLength(1);
    expect(summary.system).toBeDefined();
    expect(summary.system.docker.ok).toBe(true);
  });

  it('should create valid job fixture', () => {
    const job = createJobFixture();
    expect(job.id).toBe('job-123');
    expect(job.type).toBe('install');
    expect(job.status).toBe('running');
    expect(job.progress).toBe(50);
    expect(job.deploymentId).toBe('deployment-456');
  });

  it('should create valid catalog apps response', () => {
    const catalog = createGetCatalogAppsResponseFixture(2);
    expect(catalog.items).toHaveLength(2);
    expect(catalog.page).toBe(1);
    expect(catalog.limit).toBe(12);
    expect(catalog.total).toBe(2);
    expect(catalog.items[0].id).toBe('app-1');
    expect(catalog.items[1].id).toBe('app-2');
  });

  it('should create job fixtures for all states', () => {
    const jobs = createJobFixtures();
    expect(jobs.queued.status).toBe('queued');
    expect(jobs.running.status).toBe('running');
    expect(jobs.running.progress).toBe(42);
    expect(jobs.completed.status).toBe('completed');
    expect(jobs.completed.progress).toBe(100);
    expect(jobs.failed.status).toBe('failed');
  });

  it('should create API error response', () => {
    const error = createApiErrorResponse('NOT_FOUND', 'Resource not found', 404);
    expect(error.status).toBe(404);
    expect(error.ok).toBe(false);
  });
});