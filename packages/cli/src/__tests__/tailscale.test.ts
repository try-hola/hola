import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { HolaApiError } from '@hola/sdk';
import type { HolaSdk } from '@hola/sdk';

import {
  runTailscaleShow,
  runTailscaleEnable,
  runTailscaleLogin,
  runTailscaleDisable,
} from '../commands/deployments/tailscale';
import type { Prompter } from '../install/prompter';

const SECRET = 'tskey-auth-kABCDEF123456-SUPERSECRETVALUE';

const guidance = {
  prerequisites: ['A tailnet'],
  steps: [{ title: 'Define the Service', detail: 'Define svc:omnigraph on 443.', snippet: '{"a":1}' }],
  exampleGrant: '{}',
  exampleAutoApprover: '{}',
  notes: ['Tailnet policy is additive.'],
};

const setting = {
  enabled: true,
  serviceName: 'svc:omnigraph',
  tag: 'tag:hola-ingress',
  backend: { service: 'omnigraph', port: 8080 },
  mode: 'https' as const,
  listenPort: 443,
  forwardAuthAcknowledged: true,
  nodeName: 'hola-omnigraph',
  updatedAt: 'x',
};

function getRes(over: Record<string, unknown> = {}) {
  return {
    setting,
    credentialHeld: true,
    defaults: { backend: { service: 'omnigraph', port: 8080 }, services: ['omnigraph'], tag: 'tag:hola-ingress', mode: 'https', listenPort: 443, requiresForwardAuthAcknowledgement: false },
    status: { state: 'connected', message: 'Reachable', dnsName: 'omnigraph.example.ts.net', addresses: ['100.1.2.3'], port: 443, observedAt: 'x' },
    guidance,
    ...over,
  };
}

function makeSdk(o: { running?: boolean; get?: unknown; set?: unknown; disable?: unknown; setErr?: unknown } = {}) {
  return {
    deployments: {
      byId: vi.fn(async () => ({ id: 'dep-1', name: 'omnigraph', status: o.running === false ? 'stopped' : 'running' })),
      tailscaleIngress: {
        get: vi.fn(async () => o.get ?? getRes()),
        set: vi.fn(async () => {
          if (o.setErr) throw o.setErr;
          return o.set ?? { ok: true, setting, credentialHeld: true };
        }),
        disable: vi.fn(async () => o.disable ?? { ok: true, removal: { nodeName: 'hola-omnigraph', signedOut: null, message: 'Device removal pending.' } }),
      },
    },
    jobs: { byId: vi.fn(async () => ({ status: 'completed' })) },
  };
}

const asSdk = (s: unknown) => s as unknown as HolaSdk;
const yesPrompter = (answer: 'true' | 'false'): Prompter & { prompt: ReturnType<typeof vi.fn> } => ({
  prompt: vi.fn(async () => answer),
  note: vi.fn(),
});

describe('hola tailscale (spec 010)', () => {
  let logs: string[];
  beforeEach(() => {
    process.exitCode = 0;
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((m?: unknown) => { logs.push(String(m)); });
    vi.spyOn(console, 'error').mockImplementation((m?: unknown) => { logs.push(String(m)); });
  });
  afterEach(() => { vi.restoreAllMocks(); process.exitCode = 0; });

  const noSecretInOutput = () => expect(logs.join('\n')).not.toContain('SUPERSECRET');

  describe('show', () => {
    it('prints state, address, action and the guide', async () => {
      const sdk = makeSdk({
        get: getRes({ status: { state: 'waiting-for-approval', message: 'Not approved', action: 'Approve the host in the admin console.', dnsName: 'omnigraph.example.ts.net', port: 443, observedAt: 'x' } }),
      });
      await runTailscaleShow('dep-1', {}, { sdk: asSdk(sdk) });
      const text = logs.join('\n');
      expect(text).toContain('State: waiting-for-approval');
      expect(text).toContain('Address: https://omnigraph.example.ts.net');
      expect(text).toContain('Action: Approve the host in the admin console.');
      expect(text).toContain('Define svc:omnigraph on 443.');
      expect(text).toContain('Tailnet policy is additive.');
    });

    it('reports off when never enabled', async () => {
      const sdk = makeSdk({ get: getRes({ setting: null }) });
      await runTailscaleShow('dep-1', {}, { sdk: asSdk(sdk) });
      expect(logs.join('\n')).toContain('Private Tailscale ingress: off');
    });

    it('--json prints the response body and passes refresh', async () => {
      const sdk = makeSdk();
      await runTailscaleShow('dep-1', { json: true, refresh: true }, { sdk: asSdk(sdk) });
      expect(sdk.deployments.tailscaleIngress.get).toHaveBeenCalledWith('dep-1', { refresh: true });
      expect(JSON.parse(logs[0]).setting.serviceName).toBe('svc:omnigraph');
    });
  });

  describe('enable', () => {
    const base = { service: 'svc:omnigraph', tag: 'tag:hola-ingress' };

    it('sends the body with the credential read from a file, trimmed, and never prints it', async () => {
      const sdk = makeSdk();
      await runTailscaleEnable('dep-1', { ...base, backend: 'omnigraph:8080', mode: 'tcp', port: '8443', ackForwardAuth: true, authKeyFile: '/k', yes: true },
        { sdk: asSdk(sdk), readFile: async () => `  ${SECRET}\n` });
      expect(sdk.deployments.tailscaleIngress.set).toHaveBeenCalledWith('dep-1', {
        serviceName: 'svc:omnigraph', tag: 'tag:hola-ingress',
        backend: { service: 'omnigraph', port: 8080 }, mode: 'tcp', listenPort: 8443,
        acknowledgeForwardAuthBypass: true, authKey: SECRET,
      });
      noSecretInOutput();
    });

    it('reads the credential from stdin with --auth-key-stdin', async () => {
      const sdk = makeSdk();
      await runTailscaleEnable('dep-1', { ...base, authKeyStdin: true, yes: true }, { sdk: asSdk(sdk), readStdin: async () => `${SECRET}\n` });
      expect((sdk.deployments.tailscaleIngress.set.mock.calls as unknown[][])[0][1]).toMatchObject({ authKey: SECRET });
      noSecretInOutput();
    });

    it('omits authKey when no source is given', async () => {
      const sdk = makeSdk();
      await runTailscaleEnable('dep-1', { ...base, yes: true }, { sdk: asSdk(sdk) });
      expect((sdk.deployments.tailscaleIngress.set.mock.calls as unknown[][])[0][1]).not.toHaveProperty('authKey');
    });

    it('refuses a credential passed as a flag value, without echoing it', async () => {
      const sdk = makeSdk();
      await runTailscaleEnable('dep-1', { ...base, yes: true, authKey: SECRET }, { sdk: asSdk(sdk) });
      expect(sdk.deployments.tailscaleIngress.set).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      expect(logs.join('\n')).toContain('--auth-key-file');
      noSecretInOutput();
    });

    it('refuses a credential passed as a positional, without echoing it', async () => {
      const sdk = makeSdk();
      await runTailscaleEnable('dep-1', { ...base, yes: true, _: [SECRET] }, { sdk: asSdk(sdk) });
      expect(sdk.deployments.tailscaleIngress.set).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      noSecretInOutput();
    });

    it("does not treat '-' as stdin and rejects both sources together", async () => {
      const sdk = makeSdk();
      await runTailscaleEnable('dep-1', { ...base, yes: true, authKeyFile: '-' }, { sdk: asSdk(sdk) });
      await runTailscaleEnable('dep-1', { ...base, yes: true, authKeyFile: '/k', authKeyStdin: true }, { sdk: asSdk(sdk) });
      expect(sdk.deployments.tailscaleIngress.set).not.toHaveBeenCalled();
    });

    it('registers no flag that takes the credential as a value', async () => {
      const src = await import('node:fs').then((fs) => fs.readFileSync(new URL('../index.ts', import.meta.url), 'utf8'));
      expect(src).not.toMatch(/option\('--auth-key'[,)]/);
    });

    it('refuses without a TTY and without --yes on a running app', async () => {
      const sdk = makeSdk();
      await runTailscaleEnable('dep-1', { ...base }, { sdk: asSdk(sdk), isTTY: false });
      expect(sdk.deployments.tailscaleIngress.set).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      expect(logs.join('\n')).toContain('--yes');
    });

    it('refuses --auth-key-stdin without --yes on a running app, before reading stdin', async () => {
      const sdk = makeSdk();
      const readStdin = vi.fn(async () => SECRET);
      await runTailscaleEnable('dep-1', { ...base, authKeyStdin: true }, { sdk: asSdk(sdk), isTTY: true, readStdin, prompter: yesPrompter('true') });
      expect(readStdin).not.toHaveBeenCalled();
      expect(sdk.deployments.tailscaleIngress.set).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      expect(logs.join('\n')).toContain('--yes');
    });

    it('confirms on a TTY and aborts on no', async () => {
      const sdk = makeSdk();
      const prompter = yesPrompter('false');
      await runTailscaleEnable('dep-1', { ...base }, { sdk: asSdk(sdk), isTTY: true, prompter });
      expect(prompter.prompt).toHaveBeenCalled();
      expect(sdk.deployments.tailscaleIngress.set).not.toHaveBeenCalled();
      expect(logs).toContain('Aborted.');
    });

    it('does not ask when the app is stopped', async () => {
      const sdk = makeSdk({ running: false });
      await runTailscaleEnable('dep-1', { ...base }, { sdk: asSdk(sdk), isTTY: false });
      expect(sdk.deployments.tailscaleIngress.set).toHaveBeenCalled();
    });

    it('watches the job and --json prints the response plus status', async () => {
      const sdk = makeSdk({ set: { ok: true, jobId: 'job-1', setting, credentialHeld: true } });
      await runTailscaleEnable('dep-1', { ...base, yes: true, json: true, noStream: true }, { sdk: asSdk(sdk) });
      const parsed = JSON.parse(logs[logs.length - 1]);
      expect(parsed).toMatchObject({ ok: true, jobId: 'job-1', status: 'completed' });
    });

    it('--json failure prints the error envelope with a hint', async () => {
      const err = new HolaApiError('Name taken', 409, { code: 'CONFLICT', details: { code: 'TAILSCALE_SERVICE_NAME_TAKEN', deploymentId: 'other-1' }, requestId: 'r1' });
      const sdk = makeSdk({ setErr: err });
      await runTailscaleEnable('dep-1', { ...base, yes: true, json: true }, { sdk: asSdk(sdk) });
      const parsed = JSON.parse(logs[logs.length - 1]);
      expect(parsed.error.details.code).toBe('TAILSCALE_SERVICE_NAME_TAKEN');
      expect(parsed.hints.join(' ')).toContain('hola tailscale disable other-1');
      expect(process.exitCode).toBe(1);
    });

    it('renders next steps for ACK_REQUIRED and DEPLOYMENT_BUSY', async () => {
      let sdk = makeSdk({ setErr: new HolaApiError('ack', 400, { code: 'TAILSCALE_FORWARD_AUTH_ACK_REQUIRED' }) });
      await runTailscaleEnable('dep-1', { ...base, yes: true }, { sdk: asSdk(sdk) });
      expect(logs.join('\n')).toContain('--ack-forward-auth');
      logs.length = 0;
      sdk = makeSdk({ setErr: new HolaApiError('busy', 409, { code: 'CONFLICT', details: { code: 'DEPLOYMENT_BUSY' } }) });
      await runTailscaleEnable('dep-1', { ...base, yes: true }, { sdk: asSdk(sdk) });
      expect(logs.join('\n')).toContain('Wait for it to finish');
    });

    it('requires --service and --tag', async () => {
      const sdk = makeSdk();
      await runTailscaleEnable('dep-1', { yes: true }, { sdk: asSdk(sdk) });
      expect(sdk.deployments.tailscaleIngress.set).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });
  });

  describe('login', () => {
    it('re-sends the current setting with only the new credential', async () => {
      const sdk = makeSdk();
      await runTailscaleLogin('dep-1', { authKeyStdin: true }, { sdk: asSdk(sdk), readStdin: async () => SECRET });
      expect(sdk.deployments.tailscaleIngress.set).toHaveBeenCalledWith('dep-1', {
        serviceName: 'svc:omnigraph', tag: 'tag:hola-ingress', backend: { service: 'omnigraph', port: 8080 },
        mode: 'https', listenPort: 443, acknowledgeForwardAuthBypass: true, authKey: SECRET,
      });
      noSecretInOutput();
    });

    it('needs a credential source and an enabled setting', async () => {
      const sdk = makeSdk();
      await runTailscaleLogin('dep-1', {}, { sdk: asSdk(sdk) });
      const off = makeSdk({ get: getRes({ setting: null }) });
      await runTailscaleLogin('dep-1', { authKeyFile: '/k' }, { sdk: asSdk(off), readFile: async () => SECRET });
      expect(sdk.deployments.tailscaleIngress.set).not.toHaveBeenCalled();
      expect(off.deployments.tailscaleIngress.set).not.toHaveBeenCalled();
    });
  });

  describe('disable', () => {
    it('names the device, confirms, then disables', async () => {
      const sdk = makeSdk();
      const prompter = yesPrompter('true');
      await runTailscaleDisable('dep-1', {}, { sdk: asSdk(sdk), isTTY: true, prompter });
      expect(prompter.prompt.mock.calls[0][0].message).toContain('hola-omnigraph');
      expect(sdk.deployments.tailscaleIngress.disable).toHaveBeenCalledWith('dep-1');
      expect(logs.join('\n')).toContain('Device removal pending.');
    });

    it('--yes skips the prompt; no TTY without --yes refuses', async () => {
      const a = makeSdk();
      await runTailscaleDisable('dep-1', { yes: true }, { sdk: asSdk(a), isTTY: false });
      expect(a.deployments.tailscaleIngress.disable).toHaveBeenCalled();
      const b = makeSdk();
      await runTailscaleDisable('dep-1', {}, { sdk: asSdk(b), isTTY: false });
      expect(b.deployments.tailscaleIngress.disable).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });

    it('--json refusal is a JSON error document', async () => {
      const sdk = makeSdk();
      await runTailscaleDisable('dep-1', { json: true }, { sdk: asSdk(sdk), isTTY: false });
      expect(JSON.parse(logs[logs.length - 1]).error.message).toContain('--yes');
    });
  });
});
