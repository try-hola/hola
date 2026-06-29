/**
 * Global event bus + emit wiring for the dashboard-wide /api/events stream (#291).
 *
 * Verifies the bus fan-out/unsubscribe + error isolation, that RealJobService
 * publishes `job_update` transitions to it, and that RealDeploymentService emits
 * `deployment_update` whenever a deployment is persisted (the single chokepoint
 * for status changes).
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import type { SSEEvent } from '@hola/shared';
import { InProcessEventBus } from '../../services/core/event-bus';
import { RealDeploymentService } from '../../services/core/deployment';
import { MockProvisionerService } from '../../services/core/provisioner';
import { RealDraftService } from '../../services/core/draft';
import { RealStorageService } from '../../services/core/storage';
import { RealRoutingService } from '../../services/core/routing';
import { RealDatabaseService } from '../../services/core/database';
import { RealLoggingService } from '../../services/core/logging';
import { RealJobService } from '../../services/core/jobs';
import { MockDockerService } from '../../services/core/docker';

describe('InProcessEventBus', () => {
  test('delivers to all subscribers and stops after unsubscribe', () => {
    const bus = new InProcessEventBus();
    const a: SSEEvent[] = [];
    const b: SSEEvent[] = [];
    const subA = bus.subscribe((e) => a.push(e));
    bus.subscribe((e) => b.push(e));

    const ev: SSEEvent = { type: 'deployment_update', data: { deploymentId: 'd1', status: 'running', lastUpdated: 't' } };
    bus.emit(ev);
    expect(a).toEqual([ev]);
    expect(b).toEqual([ev]);

    subA.unsubscribe();
    bus.emit(ev);
    expect(a).toHaveLength(1); // no more after unsubscribe
    expect(b).toHaveLength(2);
  });

  test('a throwing subscriber does not break delivery to the others', () => {
    const bus = new InProcessEventBus();
    const got: SSEEvent[] = [];
    bus.subscribe(() => { throw new Error('boom'); });
    bus.subscribe((e) => got.push(e));
    const ev: SSEEvent = { type: 'job_update', data: { jobId: 'j1', status: 'completed' } };
    expect(() => bus.emit(ev)).not.toThrow();
    expect(got).toEqual([ev]);
  });
});

describe('Service emits onto the event bus (#291)', () => {
  let dataRoot: string;
  beforeEach(async () => { dataRoot = await mkdtemp(join(tmpdir(), 'hola-evt-')); });
  afterEach(async () => { await rm(dataRoot, { recursive: true, force: true }); });

  function makeCatalog() {
    return {
      getApp: async (appId: string) => ({ id: appId, name: 'Gitea', icon: '🍵' }),
      getVersionDetail: async () => ({ defaultEnv: [], defaults: { ports: [], volumes: [] } }),
      getVersions: async () => ({ items: [{ version: '1.0.0', createdAt: 't' }], total: 1 }),
    };
  }
  function makeValidation() {
    return { validateDraft: async () => ({ ok: true, errors: [], warnings: [] }), preflightCheck: async () => ({ ok: true, checks: [] }) };
  }

  test('RealJobService publishes job_update transitions (running → completed)', async () => {
    const storage = new RealStorageService({ holaDir: dataRoot });
    const database = new RealDatabaseService(storage);
    const logging = new RealLoggingService(storage);
    const bus = new InProcessEventBus();
    const events: SSEEvent[] = [];
    bus.subscribe((e) => events.push(e));

    const jobs = new RealJobService(database, logging, bus);
    jobs.setExecutor(async () => true); // succeed immediately
    const job = await jobs.createJob({ type: 'start', deploymentId: 'd1' });

    // Wait for the job to finish.
    for (let i = 0; i < 200; i++) {
      const j = await jobs.getJob(job.id);
      if (j && (j.status === 'completed' || j.status === 'failed')) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    const jobEvents = events.filter((e) => e.type === 'job_update');
    expect(jobEvents.some((e) => e.type === 'job_update' && e.data.status === 'completed' && e.data.jobId === job.id)).toBe(true);
  });

  test('RealDeploymentService emits deployment_update when a deployment is persisted', async () => {
    const storage = new RealStorageService({ holaDir: dataRoot });
    const database = new RealDatabaseService(storage);
    const logging = new RealLoggingService(storage);
    const jobs = new RealJobService(database, logging);
    const routing = new RealRoutingService(storage, { baseDomain: 'local.hola' });
    const drafts = new RealDraftService(storage, makeCatalog() as never, makeValidation() as never);
    const bus = new InProcessEventBus();
    const events: SSEEvent[] = [];
    bus.subscribe((e) => events.push(e));

    const deployments = new RealDeploymentService(storage, jobs, new MockDockerService(), drafts, routing, logging, new MockProvisionerService(), undefined, bus);

    const { draftId } = await drafts.createDraft({ appId: 'gitea', version: '1.0.0' });
    await drafts.updateDraft(draftId, { composeOverride: 'services:\n  gitea:\n    image: gitea/gitea:latest\n' });
    await drafts.finalizeDraft(draftId);
    const dep = await deployments.createFromDraft({ draftId, name: 'gitea', options: { autoStart: false } });

    const depEvents = events.filter((e) => e.type === 'deployment_update');
    expect(depEvents.length).toBeGreaterThan(0);
    expect(depEvents.some((e) => e.type === 'deployment_update' && e.data.deploymentId === dep.deploymentId)).toBe(true);
  });
});
