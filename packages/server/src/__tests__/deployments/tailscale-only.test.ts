/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #596: the `tailscale-only` exposure of private ingress. The deployment has NO
 * Traefik route, its hostname stays reserved, and every way back is a route
 * restored in the same job.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { parse } from 'yaml';

import { makeTsSystem, MARKER, type TsSystem } from './tailscale-harness';

let sys: TsSystem;
beforeEach(async () => { sys = await makeTsSystem(); });
afterEach(async () => { await sys.cleanup(); });

const BODY = { serviceName: 'svc:omnigraph', tag: 'tag:hola-ingress', backend: { service: 'app', port: 8080 }, authKey: MARKER };
const ONLY = { ...BODY, exposure: 'tailscale-only', acknowledgeTailscaleOnly: true, authKey: undefined };
const rec = (id: string) => sys.record(id);
const dynamicPath = () => join(sys.dataRoot, 'runtime', 'traefik', 'dynamic.yml');
const dynamic = async () => (existsSync(dynamicPath()) ? ((parse(await readFile(dynamicPath(), 'utf8')) as any) ?? {}) : {});
const routers = async () => Object.keys((await dynamic()).http?.routers ?? {});
const routingMap = async () => (sys.deployments as any).routingService.getRoutingMap();

/** Deploy, enable as `both`, wait until connected. */
async function connected(opts?: Parameters<TsSystem['deploy']>[0]) {
  const { deploymentId } = await sys.deploy(opts);
  const first = await sys.deployments.setTailscaleIngress(deploymentId, BODY);
  await sys.runningJob(first.jobId!);
  return deploymentId;
}
async function goTailscaleOnly(id: string, over: Record<string, unknown> = {}) {
  const res = await sys.deployments.setTailscaleIngress(id, { ...ONLY, ...over });
  await sys.runningJob(res.jobId!);
  return res;
}
const writeManifest = async (id: string, manifest: Record<string, unknown>) => {
  const rel = rec(id).currentReleaseId;
  await writeFile(join(sys.dataRoot, 'deployments', id, 'releases', rel, 'manifest.json'), JSON.stringify(manifest));
};
const refusal = async (id: string, body: unknown) => (await sys.deployments.setTailscaleIngress(id, body).catch((e) => e)) as any;

describe('routing: one decision for every route-producing path', () => {
  test('exposure absent and exposure "both" render and route exactly alike', async () => {
    const { deploymentId } = await sys.deploy();
    const base = {
      enabled: true, serviceName: 'svc:omnigraph', tag: 'tag:hola-ingress', backend: { service: 'app', port: 8080 },
      mode: 'https', listenPort: 443, forwardAuthAcknowledged: false, nodeName: 'hola-omnigraph', updatedAt: 'x',
    };
    rec(deploymentId).tailscaleIngress = { ...base };
    await sys.restart(deploymentId);
    const absentCompose = await sys.rendered(deploymentId);
    const absentRoutes = await readFile(dynamicPath(), 'utf8');
    const absentRule = (sys.deployments as any).routingRuleFor(rec(deploymentId));

    rec(deploymentId).tailscaleIngress = { ...base, exposure: 'both' };
    await sys.restart(deploymentId);
    expect(await sys.rendered(deploymentId)).toBe(absentCompose);
    expect(await readFile(dynamicPath(), 'utf8')).toBe(absentRoutes);
    expect({ ...(sys.deployments as any).routingRuleFor(rec(deploymentId)), createdAt: '' }).toEqual({ ...absentRule, createdAt: '' });
    expect(absentRule.held).toBeUndefined();
    expect((await sys.renderedDoc(deploymentId)).services.app.networks.hola.aliases).toEqual([deploymentId]);
  });

  test('tailscale-only: no router for the app, others untouched, no hola alias on the ingress service', async () => {
    const other = await sys.deploy({ app: 'other', name: 'other' });
    const id = await connected();
    expect(await routers()).toContain(id);
    await goTailscaleOnly(id);

    const names = await routers();
    expect(names).not.toContain(id);
    expect(names).toContain(other.deploymentId);
    expect(JSON.stringify(await dynamic())).not.toContain(id);

    const doc = await sys.renderedDoc(id);
    expect(doc.services.app.networks.hola).toBeUndefined();
    expect(doc.networks.hola).toBeUndefined();
    expect(doc.services.app.networks['hola-ts-backend']).toBeDefined();
    expect(doc.services['hola-tailscale']).toBeDefined();
    expect(sys.record(id).tailscaleIngress.exposure).toBe('tailscale-only');
  });

  test('a server restart (rehydration) does not resurrect the route', async () => {
    const id = await connected();
    await goTailscaleOnly(id);
    expect(await routers()).not.toContain(id);
    await (sys.deployments as any).loadFromStorage();
    expect(await routers()).not.toContain(id);
    expect((await routingMap())['app.local.hola']?.held).toBe(true);
  });

  test('an unrelated route rebuild (another deployment starting) keeps it off', async () => {
    const id = await connected();
    await goTailscaleOnly(id);
    await sys.deploy({ app: 'other', name: 'other' });
    expect(await routers()).not.toContain(id);
  });

  test('the hostname stays reserved: another install cannot claim it, and availability says taken', async () => {
    const id = await connected();
    await goTailscaleOnly(id);
    const avail = await (sys.deployments as any).routingService.checkSubdomain('app');
    expect(avail).toMatchObject({ available: false, reason: 'taken' });
    await expect(sys.deploy({ app: 'app2', name: 'app' })).rejects.toThrow(/already in use|reserved|taken/i);
  });

  test('a held rule activates immediately without waiting for a forward-auth gate', async () => {
    const id = await connected();
    await goTailscaleOnly(id);
    await writeManifest(id, { auth: { mode: 'forward-auth' } });
    await (sys.deployments as any).onActiveReleaseChanged(id);
    expect((await routingMap())['app.local.hola']?.held).toBe(true);
    expect(await routers()).not.toContain(id);
  });
});

describe('save-time refusals', () => {
  test('acknowledgement missing -> 400 TAILSCALE_ONLY_ACK_REQUIRED', async () => {
    const id = await connected();
    const err = await refusal(id, { ...ONLY, acknowledgeTailscaleOnly: undefined });
    expect(err.code).toBe('TAILSCALE_ONLY_ACK_REQUIRED');
    expect(err.status).toBe(400);
  });

  test.each(['native-oidc', 'forward-auth'])('%s release -> 400 TAILSCALE_ONLY_UNSUPPORTED_AUTH with details.authMode', async (mode) => {
    const id = await connected();
    await writeManifest(id, { auth: { mode } });
    const err = await refusal(id, { ...ONLY, acknowledgeForwardAuthBypass: true });
    expect(err.code).toBe('TAILSCALE_ONLY_UNSUPPORTED_AUTH');
    expect(err.status).toBe(400);
    expect(err.details.authMode).toBe(mode);
    const d = (await sys.deployments.getTailscaleIngress(id)).defaults;
    expect(d.tailscaleOnlySupported).toBe(false);
    expect(d.tailscaleOnlyUnsupportedReason).toContain(mode);
  });

  test('native-ldap and no-auth apps are allowed', async () => {
    const id = await connected();
    await writeManifest(id, { auth: { mode: 'native-ldap' } });
    expect((await sys.deployments.getTailscaleIngress(id)).defaults.tailscaleOnlySupported).toBe(true);
    await goTailscaleOnly(id);
    expect(rec(id).tailscaleIngress.exposure).toBe('tailscale-only');
  });

  test('a bad exposure value -> INVALID_TAILSCALE_INGRESS', async () => {
    const id = await connected();
    expect((await refusal(id, { ...BODY, exposure: 'nope' })).code).toBe('INVALID_TAILSCALE_INGRESS');
  });

  test('first-time enable as tailscale-only -> 409 TAILSCALE_ONLY_NOT_CONNECTED, nothing saved, nothing enqueued', async () => {
    const { deploymentId } = await sys.deploy();
    const before = (await sys.jobs.listJobs({ deploymentId })).length;
    const err = await refusal(deploymentId, { ...BODY, exposure: 'tailscale-only', acknowledgeTailscaleOnly: true });
    expect(err.status).toBe(409);
    expect(err.details).toMatchObject({ code: 'TAILSCALE_ONLY_NOT_CONNECTED', state: 'off' });
    expect(rec(deploymentId).tailscaleIngress).toBeUndefined();
    expect((await sys.jobs.listJobs({ deploymentId })).length).toBe(before);
    expect(existsSync(join(sys.dataRoot, 'deployments', deploymentId, 'tailscale', 'credential'))).toBe(false);
  });

  test.each(['needs-sign-in', 'waiting-for-approval', 'disconnected'] as const)('%s -> refused with the state in details', async (state) => {
    const id = await connected();
    sys.tailscale.observation = { state, message: `mock ${state}` };
    const err = await refusal(id, ONLY);
    expect(err.status).toBe(409);
    expect(err.details).toMatchObject({ code: 'TAILSCALE_ONLY_NOT_CONNECTED', state });
    expect(rec(id).tailscaleIngress.exposure).toBe('both');
  });

  test('the guard reads a FRESH status, not the cache', async () => {
    const id = await connected();
    await sys.deployments.getTailscaleIngress(id); // caches "connected"
    sys.tailscale.observation = { state: 'disconnected', message: 'down now' };
    expect((await refusal(id, ONLY)).details.state).toBe('disconnected');
  });

  test('a stopped app cannot be switched TO tailscale-only, but can be switched back to both', async () => {
    const id = await connected();
    await goTailscaleOnly(id);
    rec(id).status = 'stopped';
    const noop = await sys.deployments.setTailscaleIngress(id, { ...BODY, authKey: undefined, exposure: 'both' });
    expect(noop.jobId).toBeUndefined();
    expect((await routingMap())['app.local.hola']?.held).toBeUndefined();
    expect(await routers()).toContain(id);
    const err = await refusal(id, ONLY);
    expect(err.details).toMatchObject({ code: 'TAILSCALE_ONLY_NOT_CONNECTED', state: 'disconnected' });
  });

  test('busy -> 409 DEPLOYMENT_BUSY (same path as other setting changes)', async () => {
    const id = await connected();
    (sys.jobs as any).isDeploymentBusy = () => true;
    expect((await refusal(id, ONLY)).details.code).toBe('DEPLOYMENT_BUSY');
  });

  test('while tailscale-only, changing the Service is refused; re-saving the same settings is allowed', async () => {
    const id = await connected();
    await goTailscaleOnly(id);
    sys.tailscale.observation = { state: 'needs-sign-in', message: 'x' };
    const err = await refusal(id, { ...ONLY, serviceName: 'svc:renamed' });
    expect(err.details).toMatchObject({ code: 'TAILSCALE_ONLY_NOT_CONNECTED', reason: 'connection-settings-changed' });
    // Same settings, e.g. to supply a replacement credential, must not be blocked by the outage.
    const ok = await sys.deployments.setTailscaleIngress(id, { ...ONLY, authKey: MARKER });
    await sys.runningJob(ok.jobId!);
    expect(rec(id).tailscaleIngress.exposure).toBe('tailscale-only');
  });
});

describe('never strand the app', () => {
  test('disabling restores the route and the hola alias in the same restart job', async () => {
    const id = await connected();
    await goTailscaleOnly(id);
    expect(await routers()).not.toContain(id);
    const res = await sys.deployments.disableTailscaleIngress(id);
    await sys.runningJob(res.jobId!);
    expect(await routers()).toContain(id);
    expect((await routingMap())['app.local.hola']?.held).toBeUndefined();
    expect((await sys.renderedDoc(id)).services.app.networks.hola.aliases).toEqual([id]);
    expect(rec(id).tailscaleIngress).toBeUndefined();
  });

  test('disabling a stopped tailscale-only app restores the route too (no job runs)', async () => {
    const id = await connected();
    await goTailscaleOnly(id);
    rec(id).status = 'stopped';
    sys.companionRunning.value = false;
    await sys.deployments.disableTailscaleIngress(id);
    expect(await routers()).toContain(id);
  });

  test('switching back to both re-adds the route in one restart job', async () => {
    const id = await connected();
    await goTailscaleOnly(id);
    const before = (await sys.jobs.listJobs({ deploymentId: id })).length;
    const res = await sys.deployments.setTailscaleIngress(id, { ...BODY, authKey: undefined, exposure: 'both' });
    await sys.runningJob(res.jobId!);
    expect((await sys.jobs.listJobs({ deploymentId: id })).length).toBe(before + 1);
    expect(await routers()).toContain(id);
    expect((await sys.renderedDoc(id)).services.app.networks.hola.aliases).toEqual([id]);
    expect(rec(id).tailscaleIngress.exposure).toBe('both');
  });

  test('companion not renderable (backend gone) stays private: no route, no companion, status error naming the way out', async () => {
    const id = await connected();
    await goTailscaleOnly(id);
    rec(id).tailscaleIngress.backend.service = 'gone';
    const job = await sys.restart(id);
    expect(job.status).toBe('completed');
    expect(await routers()).not.toContain(id);
    const out = await sys.rendered(id);
    expect(out).not.toContain('hola-tailscale');
    expect((await sys.renderedDoc(id)).services.app.networks?.hola).toBeUndefined();
    const status = (await sys.deployments.getTailscaleIngress(id)).status;
    expect(status.state).toBe('error');
    expect(status.action).toMatch(/exposure to "both"/);
  });

  test('an upgrade onto an SSO release stays private, says sign-in cannot work, and the job does not fail', async () => {
    const id = await connected();
    await goTailscaleOnly(id);
    await writeManifest(id, { auth: { mode: 'forward-auth' } });
    rec(id).metadata = { ...(rec(id).metadata ?? {}), auth: undefined };
    const job = await sys.restart(id);
    expect(job.status).toBe('completed');
    expect(await routers()).not.toContain(id);
    expect(rec(id).tailscaleIngress.exposure).toBe('tailscale-only');
    const status = (await sys.deployments.getTailscaleIngress(id, { refresh: true })).status;
    expect(status.message).toMatch(/forward-auth/);
    expect(status.message).toMatch(/sign-in cannot work/);
    expect(status.action).toMatch(/exposure to "both"/);
  });

  test('native-oidc release likewise: restart completes, still private', async () => {
    const id = await connected();
    await goTailscaleOnly(id);
    await writeManifest(id, { auth: { mode: 'native-oidc', oidc: { env: {} } } });
    expect((await sys.restart(id)).status).toBe('completed');
    expect(await routers()).not.toContain(id);
    expect((await sys.deployments.getTailscaleIngress(id, { refresh: true })).status.message).toMatch(/native-oidc/);
  });
});

describe('contract-broker reach is not ingress', () => {
  test('a provider keeps its alias-less hola membership while tailscale-only', async () => {
    const id = await connected();
    await goTailscaleOnly(id);
    (sys.deployments as any).mintContractEnv = async () => ({ HOLA_CONTRACT_TOKEN: 't', HOLA_API_URL: 'http://hola-server:3001' });
    await sys.restart(id);
    const doc = await sys.renderedDoc(id);
    expect(doc.services.app.networks.hola).toEqual({});
    expect(doc.networks.hola).toEqual({ external: true });
    expect(doc.services['hola-tailscale'].networks).not.toContain('hola');
    expect(await routers()).not.toContain(id);
  });
});

describe('other consumers of the route', () => {
  const registryPath = (id: string) => join(process.env.HOLA_APPS_BIND_ROOT!, id, 'registry.json');
  const registryApps = async (id: string) => JSON.parse(await readFile(registryPath(id), 'utf8')).apps as Array<{ id: string; url?: string }>;

  test('registry feed publishes the tailnet URL for a tailscale-only app, the Traefik URL otherwise, never a dead URL', async () => {
    const hp = await sys.deploy({ app: 'hp', name: 'hp' });
    await writeManifest(hp.deploymentId, { consumes: ['app-registry'] });
    const id = await connected();
    await (sys.deployments as any).reconcileAppRegistry();
    expect((await registryApps(hp.deploymentId)).find((a) => a.id === id)?.url).toBe('https://app.local.hola');

    await goTailscaleOnly(id); // status read at the guard recorded the name
    expect(rec(id).tailscaleIngress.lastDnsName).toBe('svc.mock.ts.net');
    expect((await registryApps(hp.deploymentId)).find((a) => a.id === id)?.url).toBe('https://svc.mock.ts.net');

    // Name never observed: omit rather than publish a dead URL.
    delete rec(id).tailscaleIngress.lastDnsName;
    await (sys.deployments as any).reconcileAppRegistry();
    expect((await registryApps(hp.deploymentId)).find((a) => a.id === id)?.url).toBeUndefined();

    // Back to both: the Traefik URL is restored.
    const res = await sys.deployments.setTailscaleIngress(id, { ...BODY, authKey: undefined, exposure: 'both' });
    await sys.runningJob(res.jobId!);
    expect((await registryApps(hp.deploymentId)).find((a) => a.id === id)?.url).toBe('https://app.local.hola');
  });

  test('detail and list url follow the same rule (the dashboard "Open" link)', async () => {
    const id = await connected();
    expect((await sys.deployments.getDeployment(id)).url).toBe('https://app.local.hola');
    await goTailscaleOnly(id);
    expect((await sys.deployments.getDeployment(id)).url).toBe('https://svc.mock.ts.net');
    expect((await sys.deployments.getDeployment(id)).tailscaleIngress?.exposure).toBe('tailscale-only');
    delete rec(id).tailscaleIngress.lastDnsName;
    expect((await sys.deployments.getDeployment(id)).url).toBeUndefined();
    const list = await sys.deployments.listDeployments({} as any);
    expect(list.items.find((d: any) => d.id === id)?.url).toBeUndefined();
  });

  test('a non-default listen port is part of the tailnet URL', async () => {
    const id = await connected();
    rec(id).tailscaleIngress = { ...rec(id).tailscaleIngress, exposure: 'tailscale-only', listenPort: 8443, lastDnsName: 'svc.mock.ts.net' };
    expect((await sys.deployments.getDeployment(id)).url).toBe('https://svc.mock.ts.net:8443');
  });
});
