/**
 * Drives the private-ingress companion's `tailscaled` by exec (spec 010,
 * research R1/R3, contracts/compose.md "Commands Hola runs inside the companion").
 *
 * Every exec is `quiet: true`: the joining credential travels only on the
 * stdin of one exec, and no output of any command here is ever logged or placed
 * in an error message. Commands are argv arrays with no shell, except the one
 * fixed `sh -c` line that writes the credential to the companion's tmpfs.
 */

import {
  TAILSCALE_SERVICE,
  storedTailscaleSettingProblem,
  type TailscaleIngressSetting,
  type TailscaleIngressState,
} from '@hola/shared';
import type { DockerService } from './docker';

/** Where the companion's compose project lives. */
export interface TailscaleTarget {
  projectPath: string;
  projectName: string;
  profiles?: string[];
}

export interface TailscaleObservation {
  state: Exclude<TailscaleIngressState, 'off'>;
  message: string;
  dnsName?: string;
  addresses?: string[];
  /** The exec itself failed (container absent/not running): the caller decides `starting` vs `error`. */
  probeFailed?: boolean;
}

export type TailscaleSetting = Pick<
  TailscaleIngressSetting,
  'serviceName' | 'tag' | 'mode' | 'listenPort' | 'nodeName'
> & { backend: { port: number } };

export interface TailscaleIngressService {
  observe(target: TailscaleTarget, serviceName: string): Promise<TailscaleObservation>;
  /** Sign the companion in. `credential` is transient: stdin of one exec only. */
  signIn(target: TailscaleTarget, setting: TailscaleSetting, credential: string): Promise<{ ok: boolean; message?: string }>;
  applyServe(target: TailscaleTarget, setting: TailscaleSetting): Promise<{ ok: boolean; message?: string }>;
  /** `serve drain` then `serve clear` for one Service. */
  withdraw(target: TailscaleTarget, serviceName: string): Promise<{ ok: boolean }>;
  signOut(target: TailscaleTarget): Promise<{ ok: boolean }>;
}

const SOCKET = '--socket=/tmp/tailscaled.sock';
const KEY_FILE = '/tmp/hola-authkey';
/** The only upstream host Hola ever writes (the backend's alias on the internal network). */
const UPSTREAM_HOST = 'hola-ts-backend';

export function serveArgs(setting: TailscaleSetting): string[] {
  const upstream = setting.mode === 'tcp'
    ? `tcp://${UPSTREAM_HOST}:${setting.backend.port}`
    : `http://${UPSTREAM_HOST}:${setting.backend.port}`;
  const listen = setting.mode === 'tcp' ? `--tcp=${setting.listenPort}` : `--https=${setting.listenPort}`;
  return ['tailscale', SOCKET, 'serve', `--service=${setting.serviceName}`, listen, upstream];
}

/**
 * `tailscale up` argv. Beyond the identity flags, every routing/remote-access
 * feature is pinned OFF explicitly (FR-017), so the companion is never a subnet
 * router, exit node, exit-node client or Tailscale SSH server whatever the
 * defaults or a previous profile said. Flags verified present in v1.104.7's
 * `tailscale up --help`. Funnel, Taildrop to tagged devices and the
 * SOCKS5/HTTP proxy listeners are off by construction: Hola never runs
 * `funnel`, the serve argv has no `--funnel`, and tailscaled's argv is fixed in
 * `compose-tailscale.ts` with no `--socks5-server`/`--outbound-http-proxy-listen`.
 */
export function signInArgs(setting: TailscaleSetting): string[] {
  return [
    'tailscale', SOCKET, 'up',
    `--auth-key=file:${KEY_FILE}`,
    `--advertise-tags=${setting.tag}`,
    `--hostname=${setting.nodeName}`,
    '--ssh=false',
    '--accept-routes=false',
    '--advertise-exit-node=false',
    '--advertise-routes=',
    '--exit-node=',
  ];
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

/** Parse `tailscale status --json` defensively. Unknown shape -> `error`, never a throw. */
export function parseTailscaleStatus(raw: string, serviceName: string): TailscaleObservation {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { state: 'error', message: 'The companion returned a status Hola could not read.' };
  }
  const root = asRecord(json);
  const backendState = typeof root?.BackendState === 'string' ? root.BackendState : undefined;
  if (!root || !backendState) {
    return { state: 'error', message: 'The companion returned a status Hola could not read.' };
  }
  if (backendState === 'NeedsLogin' || backendState === 'NeedsMachineAuth') {
    return { state: 'needs-sign-in', message: 'The companion is not signed in to the tailnet.' };
  }
  // `NoState` is tailscaled before it has loaded its state: it says nothing yet
  // about whether a device identity exists, so it must not read as one.
  if (backendState === 'NoState') {
    return { state: 'starting', message: 'The companion is starting.' };
  }
  if (backendState === 'Starting') {
    return { state: 'disconnected', message: 'The companion is connecting to the tailnet.' };
  }
  if (backendState !== 'Running') {
    return { state: 'disconnected', message: `The companion is not connected (${backendState}).` };
  }
  const self = asRecord(root.Self);
  if (self?.Online === false) {
    return { state: 'disconnected', message: 'The companion is signed in but not currently reachable by the tailnet.' };
  }
  const capMap = asRecord(self?.CapMap);
  const entry = capMap?.['service-host'];
  const serialized = entry === undefined ? '' : JSON.stringify(entry);
  // Whole-name match: a plain substring test would read `svc:foo` as approved
  // when only `svc:foobar` (say, this host's previous Service name) is.
  const escaped = serviceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!new RegExp(`(^|[^A-Za-z0-9-])${escaped}([^A-Za-z0-9-]|$)`).test(serialized)) {
    return { state: 'waiting-for-approval', message: 'Signed in; the Service is not yet approved for this host.' };
  }
  const addresses = Array.from(new Set(serialized.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? []));
  const label = serviceName.replace(/^svc:/, '');
  const tailnet = asRecord(root.CurrentTailnet);
  let suffix = typeof tailnet?.MagicDNSSuffix === 'string' ? tailnet.MagicDNSSuffix : typeof root.MagicDNSSuffix === 'string' ? root.MagicDNSSuffix : undefined;
  if (!suffix && typeof self?.DNSName === 'string') {
    suffix = self.DNSName.replace(/\.$/, '').split('.').slice(1).join('.') || undefined;
  }
  return {
    state: 'connected',
    message: 'The private address is serving.',
    ...(suffix ? { dnsName: `${label}.${suffix}` } : {}),
    ...(addresses.length ? { addresses } : {}),
  };
}

/**
 * The setting was validated when written, but the record is read back as-is
 * (hand-edited, older): re-check every field that reaches argv before any exec,
 * so the upstream host stays the literal alias whatever the record says.
 */
function malformed(setting: TailscaleSetting): { ok: false; message: string } | undefined {
  const field = storedTailscaleSettingProblem(setting);
  return field
    ? { ok: false, message: `The stored private-ingress setting is malformed (${field}); disable and enable it again.` }
    : undefined;
}

export class RealTailscaleIngressService implements TailscaleIngressService {
  constructor(private readonly docker: DockerService) {}

  private exec(target: TailscaleTarget, command: string[], opts: { input?: string; timeoutMs?: number } = {}) {
    return this.docker.composeExec(target.projectPath, target.projectName, TAILSCALE_SERVICE, command, {
      profiles: target.profiles,
      quiet: true,
      ...opts,
    });
  }

  async observe(target: TailscaleTarget, serviceName: string): Promise<TailscaleObservation> {
    try {
      const res = await this.exec(target, ['tailscale', SOCKET, 'status', '--json'], { timeoutMs: 15000 });
      if (!res.success) {
        return { state: 'error', message: 'The companion could not be queried (is it running?).', probeFailed: true };
      }
      return parseTailscaleStatus(res.output, serviceName);
    } catch {
      return { state: 'error', message: 'The companion could not be queried.', probeFailed: true };
    }
  }

  async signIn(target: TailscaleTarget, setting: TailscaleSetting, credential: string) {
    const bad = malformed(setting);
    if (bad) return bad;
    // An OAuth client secret needs these parameters to mint a persistent, pre-approved device (R3).
    const payload = credential.startsWith('tskey-client-') ? `${credential}?ephemeral=false&preauthorized=true` : credential;
    try {
      const write = await this.exec(target, ['sh', '-c', `umask 077; cat > ${KEY_FILE}`], { input: payload, timeoutMs: 15000 });
      if (!write.success) return { ok: false, message: 'Could not stage the credential in the companion.' };
      const up = await this.exec(
        target,
        signInArgs(setting),
        { timeoutMs: 50000 },
      );
      return up.success ? { ok: true } : { ok: false, message: 'The companion could not sign in with the supplied credential.' };
    } catch {
      return { ok: false, message: 'Signing in failed.' };
    } finally {
      // Always, including on failure: the credential must not outlive the attempt on the tmpfs either.
      try {
        await this.exec(target, ['rm', '-f', KEY_FILE], { timeoutMs: 10000 });
      } catch { /* best effort */ }
    }
  }

  async applyServe(target: TailscaleTarget, setting: TailscaleSetting) {
    const bad = malformed(setting);
    if (bad) return bad;
    try {
      const res = await this.exec(target, serveArgs(setting), { timeoutMs: 30000 });
      return res.success ? { ok: true } : { ok: false, message: 'The companion refused the Service configuration.' };
    } catch {
      return { ok: false, message: 'Configuring the Service failed.' };
    }
  }

  async withdraw(target: TailscaleTarget, serviceName: string) {
    if (!/^svc:[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(serviceName)) return { ok: false };
    try {
      const drain = await this.exec(target, ['tailscale', SOCKET, 'serve', 'drain', serviceName], { timeoutMs: 10000 });
      const clear = await this.exec(target, ['tailscale', SOCKET, 'serve', 'clear', serviceName], { timeoutMs: 10000 });
      return { ok: drain.success && clear.success };
    } catch {
      return { ok: false };
    }
  }

  async signOut(target: TailscaleTarget) {
    try {
      const res = await this.exec(target, ['tailscale', SOCKET, 'logout'], { timeoutMs: 15000 });
      return { ok: res.success };
    } catch {
      return { ok: false };
    }
  }
}

/** Scriptable stand-in: no Docker, a call log, and settable results. */
export class MockTailscaleIngressService implements TailscaleIngressService {
  readonly calls: Array<{ op: 'observe' | 'signIn' | 'applyServe' | 'withdraw' | 'signOut'; serviceName?: string; credential?: string; setting?: TailscaleSetting }> = [];
  observation: TailscaleObservation = { state: 'needs-sign-in', message: 'mock: not signed in' };
  /** After a successful signIn the mock moves to this observation. */
  afterSignIn: TailscaleObservation = { state: 'connected', message: 'mock: serving', dnsName: 'svc.mock.ts.net', addresses: ['100.64.0.1'] };
  signInResult: { ok: boolean; message?: string } = { ok: true };
  applyResult: { ok: boolean; message?: string } = { ok: true };
  withdrawResult = { ok: true };
  signOutResult = { ok: true };
  throwOn?: 'observe' | 'signIn' | 'applyServe' | 'withdraw' | 'signOut';

  private maybeThrow(op: NonNullable<MockTailscaleIngressService['throwOn']>) {
    if (this.throwOn === op) throw new Error(`mock ${op} threw`);
  }

  async observe(_t: TailscaleTarget, serviceName: string) {
    this.calls.push({ op: 'observe', serviceName });
    this.maybeThrow('observe');
    return this.observation;
  }
  async signIn(_t: TailscaleTarget, setting: TailscaleSetting, credential: string) {
    this.calls.push({ op: 'signIn', credential, setting });
    this.maybeThrow('signIn');
    if (this.signInResult.ok) this.observation = this.afterSignIn;
    return this.signInResult;
  }
  async applyServe(_t: TailscaleTarget, setting: TailscaleSetting) {
    this.calls.push({ op: 'applyServe', setting, serviceName: setting.serviceName });
    this.maybeThrow('applyServe');
    return this.applyResult;
  }
  async withdraw(_t: TailscaleTarget, serviceName: string) {
    this.calls.push({ op: 'withdraw', serviceName });
    this.maybeThrow('withdraw');
    return this.withdrawResult;
  }
  async signOut() {
    this.calls.push({ op: 'signOut' });
    this.maybeThrow('signOut');
    return this.signOutResult;
  }
}
