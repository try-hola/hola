/**
 * End-to-end recovery smoke test — failure paths (#18).
 *
 * Exercises representative workflow failures against the REAL services on an
 * isolated temp data dir, asserting each produces an actionable error WITHOUT
 * corrupting active state. Hermetic: no real Docker daemon (a stub engine
 * simulates success/failure), no network (stub catalog).
 *
 * Coverage map for #18's required failure paths:
 *  - invalid Compose          → here (finalize blocked by validation)
 *  - routing conflict         → here (overlapping host rejected)
 *  - failed deployment job    → here (failing Compose → truthful 'error' state)
 *  - unauthorized mutation    → covered by auth/api-key.test.ts (401/403 semantics)
 */

import { describe, test, expect, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { MockDockerService } from '../../services/core/docker';
import { makeRealSystem, finalizedFixtureDraft, waitForJob } from '../helpers/real-system';

/** A Docker engine whose Compose up always fails, to drive a failed deploy job. */
class FailingDockerService extends MockDockerService {
  override async composeUp(): Promise<{ success: boolean; output: string }> {
    return { success: false, output: 'simulated compose failure' };
  }
}

describe('Smoke failure paths (real services)', () => {
  let dataRoot: string;
  afterEach(async () => {
    if (dataRoot) await rm(dataRoot, { recursive: true, force: true });
  });

  test('invalid Compose blocks finalize with an actionable error', async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'hola-smoke-'));
    const { drafts } = makeRealSystem(dataRoot);

    const { draftId } = await drafts.createDraft({ appId: 'fixture', version: '1.0.0' });
    // Parseable YAML but semantically invalid (host port publishing).
    await drafts.updateDraft(draftId, {
      composeOverride: 'services:\n  web:\n    image: nginx:1.27\n    ports:\n      - "8080:80"\n',
    });

    // Validation reports the issue...
    const report = await drafts.validateDraft(draftId);
    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => e.code === 'HOST_PORT_NOT_ALLOWED')).toBe(true);

    // ...and finalize refuses to produce an immutable spec from an invalid draft.
    await expect(drafts.finalizeDraft(draftId)).rejects.toThrow();
  });

  test('a routing conflict is detected without disturbing the existing route', async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'hola-smoke-'));
    const { routing } = makeRealSystem(dataRoot);

    const owner = routing.generateRule({ deploymentId: 'dep-owner', appName: 'grafana' });
    await routing.activateRoute(owner);

    const intruder = routing.generateRule({ deploymentId: 'dep-intruder', appName: 'grafana' });
    expect((await routing.validateRule(intruder)).length).toBeGreaterThan(0);

    // The original route is untouched and still owns the host.
    const map = await routing.getRoutingMap();
    expect(Object.values(map).some((r) => r.deploymentId === 'dep-owner')).toBe(true);
  });

  test('a failed deployment job lands in a truthful error state without corrupting the record', async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'hola-smoke-'));
    const sys = makeRealSystem(dataRoot, new FailingDockerService());

    const draftId = await finalizedFixtureDraft(sys.drafts);
    const created = await sys.deployments.createFromDraft({ draftId, name: 'will-fail' });
    expect(created.jobId).toBeDefined();

    // The job fails (Compose up returned failure)...
    expect((await waitForJob(sys.jobs, created.jobId!)).status).toBe('failed');

    // ...the deployment reports a truthful 'error' state, not a false 'running'...
    const detail = await sys.deployments.getDeployment(created.deploymentId);
    expect(detail.status).toBe('error');

    // ...and the record is intact and still consistently listed.
    const list = await sys.deployments.listDeployments({ page: 1, limit: 100 });
    expect(list.items.some((d) => d.id === created.deploymentId)).toBe(true);
  });
});
