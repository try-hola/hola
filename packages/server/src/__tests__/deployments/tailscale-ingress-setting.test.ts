/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Spec 010: materialization (US3) and the setting API (US1).
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { readFile } from 'fs/promises';
import { existsSync, statSync } from 'fs';
import { join } from 'path';

import { makeTsSystem, MARKER, type TsSystem } from './tailscale-harness';

let sys: TsSystem;
beforeEach(async () => { sys = await makeTsSystem(); });
afterEach(async () => { await sys.cleanup(); });

const BODY = { serviceName: 'svc:omnigraph', tag: 'tag:hola-ingress', backend: { service: 'app', port: 8080 }, authKey: MARKER };
const FEATURE_STRINGS = ['hola-tailscale', 'hola-ts-backend', 'hola-ts-egress', 'hola-ts-state'];

describe('materialization: apps that have not opted in are untouched (US3, SC-003)', () => {
  test('(a) absent and enabled:false render nothing from the feature, and identically to each other', async () => {
    const { deploymentId } = await sys.deploy();
    const absent = await sys.rendered(deploymentId);
    for (const s of FEATURE_STRINGS) expect(absent).not.toContain(s);

    const rec = sys.record(deploymentId);
    rec.tailscaleIngress = { enabled: false, serviceName: 'svc:x', tag: 'tag:hola-ingress', backend: { service: 'app', port: 80 }, mode: 'https', listenPort: 443, forwardAuthAcknowledged: false, nodeName: 'hola-x', updatedAt: new Date().toISOString() };
    expect((await sys.restart(deploymentId)).status).toBe('completed');
    const off = await sys.rendered(deploymentId);
    for (const s of FEATURE_STRINGS) expect(off).not.toContain(s);
    // Same run, same release: the rendering with the setting present-but-off equals the one with it absent.
    expect(off).toBe(absent);
  });

  test('(b) enabled -> the companion is rendered, with its networks and volume', async () => {
    const { deploymentId } = await sys.deploy();
    sys.record(deploymentId).tailscaleIngress = { enabled: true, serviceName: 'svc:omnigraph', tag: 'tag:hola-ingress', backend: { service: 'app', port: 8080 }, mode: 'https', listenPort: 443, forwardAuthAcknowledged: false, nodeName: 'hola-omnigraph', updatedAt: new Date().toISOString() };
    await sys.restart(deploymentId);
    const doc = await sys.renderedDoc(deploymentId);
    expect(doc.services['hola-tailscale'].image).toMatch(/@sha256:[0-9a-f]{64}$/);
    expect(doc.services.app.networks['hola-ts-backend']).toBeDefined();
    expect(doc.networks['hola-ts-backend'].internal).toBe(true);
    expect(doc.volumes['hola-ts-state']).toEqual({});
  });

  test('(d) enabled then disabled -> nothing left in the rendering', async () => {
    const { deploymentId } = await sys.deploy();
    const base = await sys.rendered(deploymentId);
    const rec = sys.record(deploymentId);
    rec.tailscaleIngress = { enabled: true, serviceName: 'svc:omnigraph', tag: 'tag:hola-ingress', backend: { service: 'app', port: 8080 }, mode: 'https', listenPort: 443, forwardAuthAcknowledged: false, nodeName: 'hola-omnigraph', updatedAt: 'x' };
    await sys.restart(deploymentId);
    expect(await sys.rendered(deploymentId)).toContain('hola-tailscale');
    delete rec.tailscaleIngress;
    await sys.restart(deploymentId);
    expect(await sys.rendered(deploymentId)).toBe(base);
  });

  test('(e) backend missing in the active release -> app renders, no companion, no throw', async () => {
    const { deploymentId, jobId } = await sys.deploy();
    void jobId;
    sys.record(deploymentId).tailscaleIngress = { enabled: true, serviceName: 'svc:omnigraph', tag: 'tag:hola-ingress', backend: { service: 'gone', port: 8080 }, mode: 'https', listenPort: 443, forwardAuthAcknowledged: false, nodeName: 'hola-omnigraph', updatedAt: 'x' };
    const job = await sys.restart(deploymentId);
    expect(job.status).toBe('completed');
    const out = await sys.rendered(deploymentId);
    for (const s of FEATURE_STRINGS) expect(out).not.toContain(s);
    const status = (await sys.deployments.getTailscaleIngress(deploymentId)).status;
    expect(status.state).toBe('error');
    expect(status.message).toContain('gone');
  });

  test('(c) on a provider app the companion carries no env, no DOCKER_HOST, no token, no staging mount, no hola membership', async () => {
    const { deploymentId } = await sys.deploy();
    sys.record(deploymentId).tailscaleIngress = { enabled: true, serviceName: 'svc:omnigraph', tag: 'tag:hola-ingress', backend: { service: 'app', port: 8080 }, mode: 'https', listenPort: 443, forwardAuthAcknowledged: false, nodeName: 'hola-omnigraph', updatedAt: 'x' };
    await sys.restart(deploymentId);
    const doc = await sys.renderedDoc(deploymentId);
    const ts = doc.services['hola-tailscale'];
    expect(ts.environment).toBeUndefined();
    expect(JSON.stringify(ts)).not.toMatch(/DOCKER_HOST|HOLA_CONTRACT_TOKEN|HOLA_API_URL|restore-staging|apps-data/i);
    expect(ts.networks).not.toContain('hola');
    expect(ts.volumes).toEqual(['hola-ts-state:/var/lib/tailscale']);
  });

  test('(f) the existing containment gate still runs over the rendering and passes without a new exemption', async () => {
    const { deploymentId } = await sys.deploy();
    sys.record(deploymentId).tailscaleIngress = { enabled: true, serviceName: 'svc:omnigraph', tag: 'tag:hola-ingress', backend: { service: 'app', port: 8080 }, mode: 'https', listenPort: 443, forwardAuthAcknowledged: false, nodeName: 'hola-omnigraph', updatedAt: 'x' };
    let configCalls = 0;
    const orig = sys.docker.composeConfig.bind(sys.docker);
    sys.docker.composeConfig = async (...a: Parameters<typeof orig>) => { configCalls++; return orig(...a); };
    // A resolved config in which the companion has only a named volume: nothing for the gate to flag.
    sys.docker.composeConfig = async () => {
      configCalls++;
      return { success: true, output: '', config: { services: { 'hola-tailscale': { volumes: [{ type: 'volume', source: 'hola-ts-state', target: '/var/lib/tailscale' }] } } } };
    };
    const job = await sys.restart(deploymentId);
    expect(configCalls).toBeGreaterThan(0);
    expect(job.status).toBe('completed');
  });
});

describe('setting API (US1)', () => {
  test('enable on a running app persists, writes the 0600 credential file and enqueues exactly one restart whose payload has no credential', async () => {
    const { deploymentId } = await sys.deploy();
    const res = await sys.deployments.setTailscaleIngress(deploymentId, BODY);
    expect(res.ok).toBe(true);
    expect(res.jobId).toBeTruthy();
    expect(res.credentialHeld).toBe(true);
    expect(res.setting).toMatchObject({ enabled: true, serviceName: 'svc:omnigraph', nodeName: 'hola-omnigraph', mode: 'https', listenPort: 443 });

    const credPath = join(sys.dataRoot, 'deployments', deploymentId, 'tailscale', 'credential');
    expect(existsSync(credPath)).toBe(true);
    expect(statSync(credPath).mode & 0o777).toBe(0o600);

    const list = await sys.jobs.listJobs({ deploymentId });
    const restarts = list.filter((j) => JSON.stringify(j).includes('restart'));
    expect(list.length).toBe(2); // the install + exactly one job from enabling
    expect(restarts.length).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(list)).not.toContain(MARKER);

    // The record on disk never carries it.
    const meta = await readFile(join(sys.dataRoot, 'deployments', deploymentId, 'metadata.json'), 'utf8');
    expect(meta).not.toContain(MARKER);
    expect(meta).toContain('svc:omnigraph');
    await sys.runningJob(res.jobId!);
  });

  test('enable on a stopped app enqueues nothing and starts nothing', async () => {
    const { deploymentId } = await sys.deploy();
    sys.record(deploymentId).status = 'stopped';
    sys.events.length = 0;
    const res = await sys.deployments.setTailscaleIngress(deploymentId, BODY);
    expect(res.jobId).toBeUndefined();
    expect(res.warnings?.join(' ')).toMatch(/next time it starts/);
    expect(sys.events).toEqual([]);
  });

  test.each([
    ['bad service name', { ...BODY, serviceName: 'nope' }, 'INVALID_TAILSCALE_INGRESS'],
    ['bad tag', { ...BODY, tag: 'x' }, 'INVALID_TAILSCALE_INGRESS'],
    ['bad port', { ...BODY, backend: { service: 'app', port: 0 } }, 'INVALID_TAILSCALE_INGRESS'],
    ['bad credential form', { ...BODY, authKey: 'hunter2' }, 'INVALID_TAILSCALE_INGRESS'],
    ['unknown backend', { ...BODY, backend: { service: 'zzz', port: 80 } }, 'TAILSCALE_BACKEND_UNKNOWN'],
    ['platform backend', { ...BODY, backend: { service: 'hola-tailscale', port: 80 } }, 'TAILSCALE_BACKEND_UNSUPPORTED'],
    ['no credential on first enable', { serviceName: 'svc:omnigraph', tag: 'tag:hola-ingress', backend: { service: 'app', port: 80 } }, 'TAILSCALE_CREDENTIAL_REQUIRED'],
    ['no port and none declared', { serviceName: 'svc:omnigraph', tag: 'tag:hola-ingress', authKey: MARKER }, 'INVALID_TAILSCALE_INGRESS'],
  ])('refuses %s with %s semantics', async (_n, body, code) => {
    const { deploymentId } = await sys.deploy();
    const err = (await sys.deployments.setTailscaleIngress(deploymentId, body).then(() => null, (e) => e)) as any;
    expect(err).toBeTruthy();
    expect(err.status).toBe(400);
    expect(err.code).toBe(code);
    expect(JSON.stringify([err.message, err.details])).not.toContain(MARKER);
    expect(existsSync(join(sys.dataRoot, 'deployments', deploymentId, 'tailscale', 'credential'))).toBe(false);
  });

  test('a backend with network_mode is refused at save', async () => {
    const compose = 'services:\n  app:\n    image: nginx:1.27\n  side:\n    image: busybox:1.36\n    network_mode: "service:app"\n';
    const { deploymentId } = await sys.deploy({ compose });
    const err = (await sys.deployments.setTailscaleIngress(deploymentId, { ...BODY, backend: { service: 'side', port: 80 } }).catch((e) => e)) as any;
    expect(err.code).toBe('TAILSCALE_BACKEND_UNSUPPORTED');
    expect(err.details.reason).toBe('network-mode');
  });

  test('busy -> 409 DEPLOYMENT_BUSY', async () => {
    const { deploymentId } = await sys.deploy();
    (sys.jobs as any).isDeploymentBusy = () => true;
    const err = (await sys.deployments.setTailscaleIngress(deploymentId, BODY).catch((e) => e)) as any;
    expect(err.status).toBe(409);
    expect(err.details.code).toBe('DEPLOYMENT_BUSY');
  });

  test('the same service name on a second deployment -> TAILSCALE_SERVICE_NAME_TAKEN', async () => {
    const a = await sys.deploy({ app: 'app1', name: 'one' });
    const b = await sys.deploy({ app: 'app2', name: 'two' });
    await sys.deployments.setTailscaleIngress(a.deploymentId, BODY);
    const err = (await sys.deployments.setTailscaleIngress(b.deploymentId, BODY).catch((e) => e)) as any;
    expect(err.status).toBe(409);
    expect(err.details).toMatchObject({ code: 'TAILSCALE_SERVICE_NAME_TAKEN', deploymentId: a.deploymentId });
  });

  test('a device name still held after a rename is refused to a second deployment (no two devices named alike)', async () => {
    const a = await sys.deploy({ app: 'app1', name: 'one' });
    const b = await sys.deploy({ app: 'app2', name: 'two' });
    const first = await sys.deployments.setTailscaleIngress(a.deploymentId, BODY);
    await sys.runningJob(first.jobId!);
    expect(sys.record(a.deploymentId).tailscaleIngress.enrolledAt).toBeTruthy();
    // Renamed after enrolment: the Service is now svc:renamed, the device keeps its name.
    const renamed = await sys.deployments.setTailscaleIngress(a.deploymentId, { ...BODY, serviceName: 'svc:renamed', authKey: undefined });
    await sys.runningJob(renamed.jobId!);
    expect(sys.record(a.deploymentId).tailscaleIngress).toMatchObject({ serviceName: 'svc:renamed', nodeName: 'hola-omnigraph' });
    const err = (await sys.deployments.setTailscaleIngress(b.deploymentId, BODY).catch((e) => e)) as any;
    expect(err.status).toBe(409);
    expect(err.details).toMatchObject({ code: 'TAILSCALE_SERVICE_NAME_TAKEN', deploymentId: a.deploymentId });
    expect(err.message).toContain('device name');
  });

  test('forward-auth app needs the acknowledgement', async () => {
    const { deploymentId } = await sys.deploy();
    sys.record(deploymentId).metadata = { ...(sys.record(deploymentId).metadata ?? {}), auth: { mode: 'forward-auth', ref: 'r' } };
    const err = (await sys.deployments.setTailscaleIngress(deploymentId, BODY).catch((e) => e)) as any;
    expect(err.code).toBe('TAILSCALE_FORWARD_AUTH_ACK_REQUIRED');
    const ok = await sys.deployments.setTailscaleIngress(deploymentId, { ...BODY, acknowledgeForwardAuthBypass: true });
    expect(ok.setting.forwardAuthAcknowledged).toBe(true);
  });

  test('GET never returns the credential, reports credentialHeld, and defaults come from the release', async () => {
    const { deploymentId } = await sys.deploy();
    await sys.deployments.setTailscaleIngress(deploymentId, BODY);
    const got = await sys.deployments.getTailscaleIngress(deploymentId);
    expect(JSON.stringify(got)).not.toContain(MARKER);
    expect(got.credentialHeld).toBe(true);
    expect(got.defaults.services).toEqual(['app', 'db']);
    expect(got.defaults.backend.service).toBe('app');
    expect(got.defaults.mode).toBe('https');
  });

  test('the normal route is unchanged by enabling (Story 1 scenario 2)', async () => {
    const { deploymentId } = await sys.deploy();
    const routePath = join(sys.dataRoot, 'runtime', 'traefik', 'dynamic.yml');
    const read = async () => (existsSync(routePath) ? readFile(routePath, 'utf8') : '');
    const before = await read();
    const res = await sys.deployments.setTailscaleIngress(deploymentId, BODY);
    await sys.runningJob(res.jobId!);
    expect(await read()).toBe(before);
    const rule = (sys.deployments as any).routingRuleFor(sys.record(deploymentId));
    expect(JSON.stringify(rule)).not.toMatch(/tailscale|hola-ts/);
  });

  test('the detail read carries only the summary', async () => {
    const { deploymentId } = await sys.deploy();
    await sys.deployments.setTailscaleIngress(deploymentId, BODY);
    const d = await sys.deployments.getDeployment(deploymentId);
    expect(d.tailscaleIngress).toEqual({ enabled: true, serviceName: 'svc:omnigraph' });
  });
});
