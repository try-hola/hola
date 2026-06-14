/**
 * End-to-end recovery smoke test — real services + real Docker (#18).
 *
 * Drives the full supported workflow against the REAL deployment path and a
 * REAL Docker daemon, then proves restart recovery: after recreating the
 * services over the same data dir (a simulated server/stack restart), the
 * deployment, its release, and its routing are still present and truthful.
 *
 * Gating: named `*.it.ts` so the default `bun test` never collects it; runs
 * only via `bun run test:integration`, and skips explicitly when Docker is
 * unavailable so the hermetic baseline stays green on daemonless hosts.
 *
 * Like docker-orchestration.it.ts, the deployed app's compose declares the
 * shared `hola` network `external: true`, so this test creates that network
 * before Compose up and removes it afterwards (only if it created it).
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { exec } from 'child_process';
import { promisify } from 'util';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { RealDockerService } from '../../services/core/docker';
import { makeRealSystem, finalizedFixtureDraft, waitForJob } from '../helpers/real-system';

const execAsync = promisify(exec);

async function sh(cmd: string): Promise<{ stdout: string; stderr: string; ok: boolean }> {
  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout: 60_000 });
    return { stdout, stderr, ok: true };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; message?: string };
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? e.message ?? '', ok: false };
  }
}

async function detectDocker(): Promise<boolean> {
  const res = await sh('docker version --format "{{.Server.Version}}"');
  return res.ok && res.stdout.trim().length > 0;
}

const dockerOk = await detectDocker();
if (!dockerOk) {
  console.warn('[#18] Docker unavailable — skipping end-to-end real-service smoke test');
}

describe.skipIf(!dockerOk)('Smoke: full workflow + restart recovery (real Docker)', () => {
  const docker = new RealDockerService();
  let dataRoot: string;
  let createdNetwork = false;
  const projects: string[] = [];

  beforeAll(async () => {
    // Ensure the external `hola` network exists; remember if we created it.
    const existing = await sh('docker network ls -q --filter "name=^hola$"');
    if (!existing.stdout.trim()) {
      await sh('docker network create hola');
      createdNetwork = true;
    }
  });

  afterAll(async () => {
    if (createdNetwork) await sh('docker network rm hola');
  });

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'hola-smoke-it-'));
  });

  afterEach(async () => {
    for (const project of projects.splice(0)) {
      const ids = await sh(`docker ps -aq --filter "label=com.docker.compose.project=${project}"`);
      const list = ids.stdout.trim().split('\n').filter(Boolean);
      if (list.length) await sh(`docker rm -fv ${list.join(' ')}`);
      const nets = await sh(`docker network ls -q --filter "name=${project}_default"`);
      const netList = nets.stdout.trim().split('\n').filter(Boolean);
      if (netList.length) await sh(`docker network rm ${netList.join(' ')}`);
    }
    await rm(dataRoot, { recursive: true, force: true });
  });

  test(
    'catalog→draft→validate→finalize→deploy→running, consistent across surfaces, survives restart',
    async () => {
      const sys = makeRealSystem(dataRoot, docker);

      // --- Install workflow through the real deployment path ----------------
      const draftId = await finalizedFixtureDraft(sys.drafts);

      // Validation passes for the supported fixture compose.
      const report = await sys.drafts.validateDraft(draftId);
      expect(report.ok).toBe(true);

      const created = await sys.deployments.createFromDraft({ draftId, name: 'smoke' });
      projects.push(`hola-${created.deploymentId.slice(0, 12)}`);
      expect((await waitForJob(sys.jobs, created.jobId!, 120_000)).status).toBe('completed');

      // Detail/list/history are consistent from one state source.
      const detail = await sys.deployments.getDeployment(created.deploymentId);
      expect(detail.status).toBe('running');
      const list = await sys.deployments.listDeployments({ page: 1, limit: 100 });
      expect(list.items.find((d) => d.id === created.deploymentId)?.status).toBe('running');
      const history = await sys.deployments.getDeploymentHistory(created.deploymentId, { page: 1, limit: 100 });
      expect(history.items.some((j) => j.id === created.jobId)).toBe(true);

      // --- Restart recovery: rebuild services over the same data dir --------
      const restarted = makeRealSystem(dataRoot, docker);
      const afterRestart = await restarted.deployments.getDeployment(created.deploymentId);
      expect(afterRestart.id).toBe(created.deploymentId);
      expect(afterRestart.status).toBe('running');

      // The release survived too.
      const releases = await restarted.deployments.getReleases(created.deploymentId);
      expect(releases.length).toBeGreaterThanOrEqual(1);

      // Routing state is durable.
      const map = await restarted.routing.getRoutingMap();
      expect(Object.values(map).some((r) => r.deploymentId === created.deploymentId)).toBe(true);

      // --- Clean up: stop the deployment ------------------------------------
      const stop = await restarted.deployments.executeAction(created.deploymentId, { action: 'stop' });
      expect((await waitForJob(restarted.jobs, stop.jobId!)).status).toBe('completed');
    },
    180_000,
  );
});
