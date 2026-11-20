/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Spec 010: the lifecycle hooks (enable, survive, disable, uninstall) and secret
 * hygiene, with a stubbed companion driver and a recording Docker mock.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync } from 'fs';
import { readFile, readdir } from 'fs/promises';
import { join } from 'path';

import { makeTsSystem, MARKER, DEFAULT_COMPOSE, type TsSystem } from './tailscale-harness';

let sys: TsSystem;
beforeEach(async () => { sys = await makeTsSystem(); });
afterEach(async () => { await sys.cleanup(); });

const BODY = { serviceName: 'svc:omnigraph', tag: 'tag:hola-ingress', backend: { service: 'app', port: 8080 }, authKey: MARKER };
const credFile = (id: string) => join(sys.dataRoot, 'deployments', id, 'tailscale', 'credential');

async function enable(body: Record<string, unknown> = BODY, name = 'app') {
  const { deploymentId } = await sys.deploy({ app: name, name });
  const res = await sys.deployments.setTailscaleIngress(deploymentId, body);
  const job = await sys.runningJob(res.jobId!);
  return { deploymentId, job, res };
}

describe('enable', () => {
  test('restart job signs in once with the stored credential, applies the Service, deletes the credential, sets enrolledAt', async () => {
    const { deploymentId, job } = await enable();
    expect(job.status).toBe('completed');
    const ops = sys.tailscale.calls.map((c) => c.op);
    expect(ops.filter((o) => o === 'signIn')).toHaveLength(1);
    expect(ops.filter((o) => o === 'applyServe')).toHaveLength(1);
    expect(sys.tailscale.calls.find((c) => c.op === 'signIn')!.credential).toBe(MARKER);
    const serve = sys.tailscale.calls.find((c) => c.op === 'applyServe')!;
    expect(serve.setting).toMatchObject({ serviceName: 'svc:omnigraph', mode: 'https', listenPort: 443, backend: { port: 8080 } });
    expect(existsSync(credFile(deploymentId))).toBe(false);
    const rec = sys.record(deploymentId).tailscaleIngress;
    expect(rec.enrolledAt).toBeTruthy();
    expect(rec.applied).toEqual({ serviceName: 'svc:omnigraph', mode: 'https', listenPort: 443, backendPort: 8080 });
    const st = (await sys.deployments.getTailscaleIngress(deploymentId, { refresh: true })).status;
    expect(st.state).toBe('connected');
    expect(st.dnsName).toBe('svc.mock.ts.net');
  });

  test('a second restart does not sign in again, but re-applies the unchanged serve config (research V1 fallback)', async () => {
    const { deploymentId } = await enable();
    const before = sys.record(deploymentId).tailscaleIngress.updatedAt;
    sys.tailscale.calls.length = 0;
    expect((await sys.restart(deploymentId)).status).toBe('completed');
    const ops = sys.tailscale.calls.map((c) => c.op);
    expect(ops).not.toContain('signIn');
    expect(ops).not.toContain('withdraw');
    expect(ops.filter((o) => o === 'applyServe')).toHaveLength(1);
    // Nothing changed, so the record is not rewritten.
    expect(sys.record(deploymentId).tailscaleIngress.updatedAt).toBe(before);
  });

  test('companion stuck at needs-sign-in: the job still completes, the credential is kept, the status says so', async () => {
    sys.tailscale.signInResult = { ok: false, message: 'Signing in to the tailnet failed.' };
    const { deploymentId, job } = await enable();
    expect(job.status).toBe('completed');
    expect(existsSync(credFile(deploymentId))).toBe(true);
    const st = (await sys.deployments.getTailscaleIngress(deploymentId, { refresh: true })).status;
    expect(st.state).toBe('needs-sign-in');
    expect(st.action).toBeTruthy();
    expect(sys.record(deploymentId).tailscaleIngress.enrolledAt).toBeUndefined();
  });

  test('a throwing hook never fails the job', async () => {
    sys.tailscale.throwOn = 'applyServe';
    const { job, deploymentId } = await enable();
    expect(job.status).toBe('completed');
    expect(sys.record(deploymentId).status).toBe('running');
  });

  test('changing the service name drains the old one, then applies the new one', async () => {
    const { deploymentId } = await enable();
    sys.tailscale.calls.length = 0;
    const res = await sys.deployments.setTailscaleIngress(deploymentId, { serviceName: 'svc:renamed', tag: 'tag:hola-ingress', backend: { service: 'app', port: 8080 } });
    await sys.runningJob(res.jobId!);
    const seq = sys.tailscale.calls.filter((c) => c.op === 'withdraw' || c.op === 'applyServe').map((c) => `${c.op}:${c.serviceName}`);
    expect(seq).toEqual(['withdraw:svc:omnigraph', 'applyServe:svc:renamed']);
  });

  test('a new credential while signed in is deleted unused and signIn is not called (FR-023)', async () => {
    const { deploymentId } = await enable();
    sys.tailscale.calls.length = 0;
    const res = await sys.deployments.setTailscaleIngress(deploymentId, { ...BODY, authKey: 'tskey-auth-kSECOND-zzzzzzzz' });
    expect(existsSync(credFile(deploymentId))).toBe(true);
    await sys.runningJob(res.jobId!);
    expect(sys.tailscale.calls.map((c) => c.op)).not.toContain('signIn');
    expect(existsSync(credFile(deploymentId))).toBe(false);
  });

  test('expired identity: a new credential recovers sign-in without a second enrolment', async () => {
    const { deploymentId } = await enable();
    sys.tailscale.observation = { state: 'needs-sign-in', message: 'expired' };
    const res = await sys.deployments.setTailscaleIngress(deploymentId, { ...BODY, authKey: 'tskey-auth-kNEWNEW-zzzzzzzz' });
    await sys.runningJob(res.jobId!);
    expect(sys.tailscale.calls.filter((c) => c.op === 'signIn').length).toBe(2);
    expect(sys.record(deploymentId).tailscaleIngress.nodeName).toBe('hola-omnigraph');
  });

  test('a re-sign-in re-applies the Service even when `applied` already matches (logout drops serve config)', async () => {
    const { deploymentId } = await enable();
    sys.tailscale.observation = { state: 'needs-sign-in', message: 'logged out' };
    sys.tailscale.calls.length = 0;
    const res = await sys.deployments.setTailscaleIngress(deploymentId, { ...BODY, authKey: 'tskey-auth-kAGAIN-zzzzzzzz' });
    await sys.runningJob(res.jobId!);
    const ops = sys.tailscale.calls.map((c) => c.op);
    expect(ops).toContain('signIn');
    expect(ops).toContain('applyServe');
  });

  test('a first probe that cannot tell (NoState/unreadable) keeps the credential and does not sign in or serve', async () => {
    const { deploymentId } = await sys.deploy();
    for (const state of ['starting', 'error'] as const) {
      sys.tailscale.observation = { state, message: state };
      sys.tailscale.calls.length = 0;
      const res = await sys.deployments.setTailscaleIngress(deploymentId, BODY);
      expect((await sys.runningJob(res.jobId!)).status).toBe('completed');
      expect(existsSync(credFile(deploymentId))).toBe(true);
      const ops = sys.tailscale.calls.map((c) => c.op);
      expect(ops).not.toContain('signIn');
      expect(ops).not.toContain('applyServe');
      expect(sys.record(deploymentId).tailscaleIngress.enrolledAt).toBeUndefined();
    }
  });

  test('changing the listen port or mode clears the old listener before applying the new one', async () => {
    const { deploymentId } = await enable();
    for (const change of [{ listenPort: 8443 }, { listenPort: 8443, mode: 'tcp' }]) {
      sys.tailscale.calls.length = 0;
      const res = await sys.deployments.setTailscaleIngress(deploymentId, { serviceName: 'svc:omnigraph', tag: 'tag:hola-ingress', backend: { service: 'app', port: 8080 }, ...change });
      await sys.runningJob(res.jobId!);
      const seq = sys.tailscale.calls.filter((c) => c.op === 'withdraw' || c.op === 'applyServe').map((c) => `${c.op}:${c.serviceName}`);
      expect(seq).toEqual(['withdraw:svc:omnigraph', 'applyServe:svc:omnigraph']);
    }
  });

  test('a changed backend port alone replaces in place without withdrawing', async () => {
    const { deploymentId } = await enable();
    sys.tailscale.calls.length = 0;
    const res = await sys.deployments.setTailscaleIngress(deploymentId, { serviceName: 'svc:omnigraph', tag: 'tag:hola-ingress', backend: { service: 'app', port: 9090 } });
    await sys.runningJob(res.jobId!);
    const ops = sys.tailscale.calls.map((c) => c.op);
    expect(ops).not.toContain('withdraw');
    expect(ops).toContain('applyServe');
  });
});

describe('survives ordinary operations', () => {
  test('stop/start keep the setting and do not re-enrol', async () => {
    const { deploymentId } = await enable();
    sys.tailscale.calls.length = 0;
    for (const action of ['stop', 'start'] as const) {
      const { jobId } = await sys.deployments.executeAction(deploymentId, { action });
      expect((await sys.runningJob(jobId!)).status).toBe('completed');
    }
    expect(sys.record(deploymentId).tailscaleIngress.enabled).toBe(true);
    expect(sys.tailscale.calls.map((c) => c.op)).not.toContain('signIn');
    expect(await sys.rendered(deploymentId)).toContain('hola-tailscale');
  });

  test('promote and rollback keep the setting, and the rendering still has the companion', async () => {
    const { deploymentId } = await enable();
    const first = sys.record(deploymentId).currentReleaseId;
    const { draftId } = await sys.drafts.createDraft({ appId: 'app', version: '1.1.0' });
    await sys.drafts.updateDraft(draftId, { composeOverride: DEFAULT_COMPOSE });
    await sys.drafts.finalizeDraft(draftId);
    const p = await sys.deployments.promote(deploymentId, { draftId });
    expect((await sys.runningJob(p.jobId!)).status).toBe('completed');
    expect(sys.record(deploymentId).tailscaleIngress.enabled).toBe(true);
    expect(await sys.rendered(deploymentId)).toContain('hola-tailscale');

    const rb = await sys.deployments.rollback(deploymentId, { targetReleaseId: first });
    expect((await sys.runningJob(rb.jobId)).status).toBe('completed');
    expect(sys.record(deploymentId).tailscaleIngress.enabled).toBe(true);
    expect(await sys.rendered(deploymentId)).toContain('hola-tailscale');
  });

  test('a different companion image keeps the setting and volume and does not re-enrol (FR-024)', async () => {
    const { deploymentId } = await enable();
    sys.tailscale.calls.length = 0;
    const prev = process.env.HOLA_TAILSCALE_IMAGE;
    process.env.HOLA_TAILSCALE_IMAGE = 'mirror/ts:v1.104.9';
    try {
      expect((await sys.restart(deploymentId)).status).toBe('completed');
      expect((await sys.renderedDoc(deploymentId)).services['hola-tailscale'].image).toBe('mirror/ts:v1.104.9');
    } finally {
      if (prev === undefined) delete process.env.HOLA_TAILSCALE_IMAGE; else process.env.HOLA_TAILSCALE_IMAGE = prev;
    }
    expect(sys.tailscale.calls.map((c) => c.op)).not.toContain('signIn');
    expect(sys.events.filter((e) => e.startsWith('rmvolume'))).toEqual([]);
  });

  test('tailnet unreachable (observe -> disconnected): deploy and restart complete (SC-006)', async () => {
    sys.tailscale.observation = { state: 'disconnected', message: 'no route' };
    const { deploymentId, job } = await enable();
    expect(job.status).toBe('completed');
    expect((await sys.restart(deploymentId)).status).toBe('completed');
    expect((await sys.deployments.getTailscaleIngress(deploymentId, { refresh: true })).status.state).toBe('disconnected');
  });

  test('companion image pull failure fails the deploy and the error names the image (T040)', async () => {
    const { deploymentId } = await enable();
    sys.docker.composePull = async () => ({ success: false, output: 'pull access denied' });
    const { jobId } = await sys.deployments.executeAction(deploymentId, { action: 'stop' });
    await sys.runningJob(jobId!);
    const { jobId: j2 } = await sys.deployments.executeAction(deploymentId, { action: 'start' });
    const job = await sys.runningJob(j2!);
    expect(job.status).toBe('failed');
    expect(job.error).toMatch(/tailscale\/tailscale:v\d+\.\d+\.\d+@sha256:[0-9a-f]{64}/);
  });
});

describe('disable and uninstall', () => {
  const vol = (id: string) => `rmvolume:hola-${id}_hola-ts-state`;

  test('disable on a running app: withdraw, signOut, remove companion, up, then volume + both networks; setting cleared', async () => {
    const { deploymentId } = await enable();
    sys.events.length = 0;
    const res = await sys.deployments.disableTailscaleIngress(deploymentId);
    expect(res.removal).toMatchObject({ nodeName: 'hola-omnigraph', signedOut: null });
    expect(res.removal!.message).toContain('hola-omnigraph');
    expect((await sys.runningJob(res.jobId!)).status).toBe('completed');
    expect(sys.events).toEqual([
      'ts:withdraw', 'ts:signOut', 'rm:hola-tailscale', 'up',
      vol(deploymentId),
      `rmnetwork:hola-${deploymentId}_hola-ts-backend`, `rmnetwork:hola-${deploymentId}_hola-ts-egress`,
    ]);
    expect(sys.record(deploymentId).tailscaleIngress).toBeUndefined();
    expect(await sys.rendered(deploymentId)).not.toContain('hola-tailscale');
    const st = (await sys.deployments.getTailscaleIngress(deploymentId)).status;
    expect(st.state).toBe('off');
    expect(st.message).toContain('signed out');
    expect(st.message).toContain('hola-omnigraph');
  });

  test('disable when signOut fails: cleanup still completes and the report says not signed out', async () => {
    const { deploymentId } = await enable();
    sys.tailscale.signOutResult = { ok: false };
    const res = await sys.deployments.disableTailscaleIngress(deploymentId);
    expect((await sys.runningJob(res.jobId!)).status).toBe('completed');
    expect(sys.events).toContain(vol(deploymentId));
    const st = (await sys.deployments.getTailscaleIngress(deploymentId)).status;
    expect(st.message).toContain('could NOT be signed out');
  });

  test('failing to remove the companion fails the job and keeps the pending removal', async () => {
    const { deploymentId } = await enable();
    sys.docker.failRemoval = (kind) => kind === 'service';
    const res = await sys.deployments.disableTailscaleIngress(deploymentId);
    expect((await sys.runningJob(res.jobId!)).status).toBe('failed');
    expect(sys.record(deploymentId).tailscaleIngress.removalPending).toBe(true);
  });

  test('disable on a stopped app: no job, volume removed, signedOut false', async () => {
    const { deploymentId } = await enable();
    const { jobId } = await sys.deployments.executeAction(deploymentId, { action: 'stop' });
    await sys.runningJob(jobId!);
    sys.companionRunning.value = false; // `compose down` removed it
    sys.events.length = 0;
    const res = await sys.deployments.disableTailscaleIngress(deploymentId);
    expect(res.jobId).toBeUndefined();
    expect(res.removal).toMatchObject({ signedOut: false });
    expect(sys.events).toContain(vol(deploymentId));
    expect(sys.events).not.toContain('up');
    expect(sys.events).not.toContain('ts:signOut');
    expect(sys.record(deploymentId).tailscaleIngress).toBeUndefined();
  });

  test('disable when the record is not running but the companion still is: signs out and removes it before cleanup', async () => {
    const { deploymentId } = await enable();
    // A failed job leaves `error` with the containers still up.
    sys.record(deploymentId).status = 'error';
    sys.companionRunning.value = true;
    sys.events.length = 0;
    const res = await sys.deployments.disableTailscaleIngress(deploymentId);
    expect(res.jobId).toBeUndefined();
    expect(res.removal).toMatchObject({ signedOut: true });
    expect(sys.events).toEqual([
      'ts:withdraw', 'ts:signOut', 'rm:hola-tailscale',
      vol(deploymentId),
      `rmnetwork:hola-${deploymentId}_hola-ts-backend`, `rmnetwork:hola-${deploymentId}_hola-ts-egress`,
    ]);
    expect(sys.record(deploymentId).tailscaleIngress).toBeUndefined();
  });

  test('disable when the record is not running and the companion cannot be removed: refuses and keeps the setting', async () => {
    const { deploymentId } = await enable();
    sys.record(deploymentId).status = 'error';
    sys.docker.failRemoval = (kind) => kind === 'service';
    await expect(sys.deployments.disableTailscaleIngress(deploymentId)).rejects.toThrow(/companion/);
    expect(sys.record(deploymentId).tailscaleIngress.enabled).toBe(true);
    expect(sys.events.filter((e) => e.startsWith('rmvolume'))).toEqual([]);
  });

  test('disable when already off is a no-op', async () => {
    const { deploymentId } = await sys.deploy();
    expect(await sys.deployments.disableTailscaleIngress(deploymentId)).toEqual({ ok: true });
    expect(sys.events).toEqual([]);
  });

  test('uninstall signs the device out first, removes the volume and returns the message as a warning', async () => {
    const { deploymentId } = await enable();
    sys.events.length = 0;
    const out = (await sys.deployments.deleteDeployment(deploymentId)) as { warnings?: string[] };
    expect(sys.events.indexOf('ts:signOut')).toBeLessThan(sys.events.indexOf('down'));
    expect(sys.events).toContain(vol(deploymentId));
    expect(out.warnings?.[0]).toContain('hola-omnigraph');
    expect(existsSync(join(sys.dataRoot, 'deployments', deploymentId))).toBe(false);
  });

  test('force uninstall makes no exec but still removes the volume', async () => {
    const { deploymentId } = await enable();
    sys.events.length = 0;
    const out = (await sys.deployments.deleteDeployment(deploymentId, { force: true })) as { warnings?: string[] };
    expect(sys.events).not.toContain('ts:signOut');
    expect(sys.events).toContain(vol(deploymentId));
    expect(out.warnings?.[0]).toContain('could NOT be signed out');
  });

  test('uninstall of an app that never used private ingress touches nothing of the feature', async () => {
    const { deploymentId } = await sys.deploy();
    sys.events.length = 0;
    const out = await sys.deployments.deleteDeployment(deploymentId);
    expect(out).toBeUndefined();
    expect(sys.events.filter((e) => e.startsWith('rmvolume') || e.startsWith('rmnetwork') || e.startsWith('ts:'))).toEqual([]);
  });
});

describe('restore-on-install', () => {
  test('a restore source with private ingress contributes no setting, credential or volume to the new install (FR-022)', async () => {
    const { deploymentId } = await enable();
    const source = await sys.deployments.getRestoreSource(deploymentId);
    expect(JSON.stringify(source ?? {})).not.toMatch(/tskey|hola-ts-state/i);
    const second = await sys.deploy({ app: 'other', name: 'other' });
    expect(sys.record(second.deploymentId).tailscaleIngress).toBeUndefined();
    expect(existsSync(credFile(second.deploymentId))).toBe(false);
  });
});

describe('secret hygiene (SC-007)', () => {
  test('the marker credential appears nowhere but the one stdin exec', async () => {
    const logs: string[] = [];
    const orig = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
    for (const k of Object.keys(orig) as Array<keyof typeof orig>) (console as any)[k] = (...a: unknown[]) => logs.push(a.map(String).join(' '));
    const responses: unknown[] = [];
    try {
      const { deploymentId } = await sys.deploy();
      responses.push(await sys.deployments.setTailscaleIngress(deploymentId, BODY));
      await sys.runningJob((responses[0] as any).jobId);
      responses.push(await sys.deployments.getTailscaleIngress(deploymentId, { refresh: true }));
      responses.push(await sys.deployments.getDeployment(deploymentId));
      const again = await sys.deployments.setTailscaleIngress(deploymentId, { ...BODY, authKey: MARKER });
      responses.push(again);
      await sys.runningJob(again.jobId!);
      const dis = await sys.deployments.disableTailscaleIngress(deploymentId);
      responses.push(dis);
      await sys.runningJob(dis.jobId!);

      const dir = join(sys.dataRoot, 'deployments', deploymentId);
      const walk = async (d: string): Promise<string[]> => {
        const out: string[] = [];
        for (const e of await readdir(d, { withFileTypes: true })) {
          const p = join(d, e.name);
          if (e.isDirectory()) out.push(...(await walk(p)));
          else out.push(p);
        }
        return out;
      };
      for (const f of await walk(dir)) expect(await readFile(f, 'utf8')).not.toContain(MARKER);
      expect(await walk(dir).then((l) => l.filter((f) => f.endsWith('/credential')))).toEqual([]);
      expect(existsSync(credFile(deploymentId))).toBe(false);
      const jobs = await sys.jobs.listJobs({ deploymentId });
      expect(JSON.stringify(jobs)).not.toContain(MARKER);
      expect(JSON.stringify(responses)).not.toContain(MARKER);
      expect(logs.join('\n')).not.toContain(MARKER);
      // docker mock call log: argv never; stdin only
      for (const c of sys.docker.composeExecCalls) expect(JSON.stringify(c.command)).not.toContain(MARKER);
      expect(JSON.stringify(sys.docker.removalCalls)).not.toContain(MARKER);
    } finally {
      Object.assign(console, orig);
    }
  });
});

describe('status and guidance (US5/US6)', () => {
  test('never-enabled: off, defaults and placeholder guidance', async () => {
    const { deploymentId } = await sys.deploy({ app: 'omnigraph', name: 'omnigraph' });
    const g = await sys.deployments.getTailscaleIngress(deploymentId);
    expect(g.setting).toBeNull();
    expect(g.status.state).toBe('off');
    expect(g.guidance.steps).toHaveLength(4);
    expect(g.guidance.exampleGrant).toContain('svc:omnigraph');
    expect(g.defaults.backend.port).toBeNull();
  });

  test('waiting-for-approval carries an action naming both steps', async () => {
    sys.tailscale.afterSignIn = { state: 'waiting-for-approval', message: 'x' };
    const { deploymentId } = await enable();
    const st = (await sys.deployments.getTailscaleIngress(deploymentId, { refresh: true })).status;
    expect(st.state).toBe('waiting-for-approval');
    expect(st.action).toMatch(/define the Service/);
    expect(st.action).toMatch(/approve/);
  });

  test('a stopped app reads disconnected; the status is cached for 30 s unless refreshed', async () => {
    const { deploymentId } = await enable();
    await sys.deployments.getTailscaleIngress(deploymentId, { refresh: true });
    const n = () => sys.tailscale.calls.filter((c) => c.op === 'observe').length;
    const before = n();
    await sys.deployments.getTailscaleIngress(deploymentId);
    expect(n()).toBe(before);
    await sys.deployments.getTailscaleIngress(deploymentId, { refresh: true });
    expect(n()).toBe(before + 1);
    sys.record(deploymentId).status = 'stopped';
    expect((await sys.deployments.getTailscaleIngress(deploymentId)).status.state).toBe('disconnected');
  });

  test('probe failure right after up reads starting; later reads error', async () => {
    const { deploymentId } = await enable();
    sys.tailscale.observation = { state: 'error', message: 'x', probeFailed: true };
    expect((await sys.deployments.getTailscaleIngress(deploymentId, { refresh: true })).status.state).toBe('starting');
    (sys.deployments as any).tsLastUp.set(deploymentId, 0);
    expect((await sys.deployments.getTailscaleIngress(deploymentId, { refresh: true })).status.state).toBe('error');
  });

  test('another backend: that service joins the backend network and the ingress service does not (US6)', async () => {
    const { deploymentId } = await sys.deploy();
    const res = await sys.deployments.setTailscaleIngress(deploymentId, { ...BODY, backend: { service: 'db', port: 5432 }, mode: 'tcp', listenPort: 5432 });
    await sys.runningJob(res.jobId!);
    const doc = await sys.renderedDoc(deploymentId);
    expect(doc.services.db.networks['hola-ts-backend']).toBeDefined();
    expect(doc.services.app.networks['hola-ts-backend']).toBeUndefined();
    const serve = sys.tailscale.calls.find((c) => c.op === 'applyServe')!;
    expect(serve.setting).toMatchObject({ mode: 'tcp', listenPort: 5432, backend: { port: 5432 } });
  });

  test('after a rollback to a release lacking the chosen service: error naming it, and applyServe is not called', async () => {
    const compose2 = 'services:\n  app:\n    image: nginx:1.27\n  extra:\n    image: busybox:1.36\n';
    const { deploymentId } = await sys.deploy({ compose: compose2 });
    const first = sys.record(deploymentId).currentReleaseId;
    // upgrade to a release that has `extra`... first release has it too; so choose a service only the 2nd has.
    const { draftId } = await sys.drafts.createDraft({ appId: 'app', version: '1.1.0' });
    await sys.drafts.updateDraft(draftId, { composeOverride: 'services:\n  app:\n    image: nginx:1.27\n  newsvc:\n    image: busybox:1.36\n' });
    await sys.drafts.finalizeDraft(draftId);
    const p = await sys.deployments.promote(deploymentId, { draftId });
    await sys.runningJob(p.jobId!);
    const res = await sys.deployments.setTailscaleIngress(deploymentId, { ...BODY, backend: { service: 'newsvc', port: 80 } });
    await sys.runningJob(res.jobId!);
    sys.tailscale.calls.length = 0;
    const rb = await sys.deployments.rollback(deploymentId, { targetReleaseId: first, imageOnly: true } as any);
    expect((await sys.runningJob(rb.jobId)).status).toBe('completed');
    expect(sys.tailscale.calls.map((c) => c.op)).not.toContain('applyServe');
    const st = (await sys.deployments.getTailscaleIngress(deploymentId, { refresh: true })).status;
    expect(st.state).toBe('error');
    expect(st.message).toContain('newsvc');
  });
});
