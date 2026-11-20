/**
 * Spec 010: status mapping (research R10) and the exec-driven driver's commands.
 */
import { describe, test, expect } from 'bun:test';
import { parseTailscaleStatus, RealTailscaleIngressService, serveArgs } from '../../services/core/tailscale-ingress';
import { MockDockerService } from '../../services/core/docker';

const SVC = 'svc:omnigraph';
const MARKER = 'tskey-auth-kSTATUSMARKER-0000';
const j = (o: unknown) => JSON.stringify(o);

describe('parseTailscaleStatus', () => {
  test('NeedsLogin -> needs-sign-in', () => {
    expect(parseTailscaleStatus(j({ BackendState: 'NeedsLogin' }), SVC).state).toBe('needs-sign-in');
    expect(parseTailscaleStatus(j({ BackendState: 'NeedsMachineAuth' }), SVC).state).toBe('needs-sign-in');
  });

  test('Running without the Service in CapMap -> waiting-for-approval', () => {
    const o = parseTailscaleStatus(j({ BackendState: 'Running', Self: { Online: true, CapMap: {} } }), SVC);
    expect(o.state).toBe('waiting-for-approval');
    expect(o.dnsName).toBeUndefined();
  });

  test('Running with the Service -> connected, with dnsName and addresses', () => {
    const o = parseTailscaleStatus(
      j({
        BackendState: 'Running',
        CurrentTailnet: { MagicDNSSuffix: 'example.ts.net' },
        Self: { Online: true, CapMap: { 'service-host': [{ [SVC]: ['100.100.1.2', '100.100.1.2'] }] } },
      }),
      SVC,
    );
    expect(o.state).toBe('connected');
    expect(o.dnsName).toBe('omnigraph.example.ts.net');
    expect(o.addresses).toEqual(['100.100.1.2']);
  });

  test('dnsName falls back to the Self.DNSName suffix', () => {
    const o = parseTailscaleStatus(
      j({ BackendState: 'Running', Self: { Online: true, DNSName: 'hola-omnigraph.tail1.ts.net.', CapMap: { 'service-host': [SVC] } } }),
      SVC,
    );
    expect(o.dnsName).toBe('omnigraph.tail1.ts.net');
  });

  test('NoState -> starting (no evidence of an identity either way)', () => {
    expect(parseTailscaleStatus(j({ BackendState: 'NoState' }), SVC).state).toBe('starting');
  });

  test('a longer Service name that merely starts with this one is not this one', () => {
    const o = parseTailscaleStatus(
      j({ BackendState: 'Running', Self: { Online: true, CapMap: { 'service-host': [{ [`${SVC}-old`]: ['100.100.1.9'] }] } } }),
      SVC,
    );
    expect(o.state).toBe('waiting-for-approval');
  });

  test('Online:false -> disconnected', () => {
    expect(parseTailscaleStatus(j({ BackendState: 'Running', Self: { Online: false } }), SVC).state).toBe('disconnected');
  });

  test.each(['', 'not json', '[]', '{}', '{"BackendState":5}', 'null'])('malformed %p -> error, never a throw', (raw) => {
    expect(parseTailscaleStatus(raw, SVC).state).toBe('error');
  });
});

describe('RealTailscaleIngressService', () => {
  const target = { projectPath: '/p', projectName: 'proj' };

  test('observe: exec failure -> error with probeFailed', async () => {
    const docker = new MockDockerService();
    docker.execHandler = () => ({ success: false, output: 'container not running' });
    const o = await new RealTailscaleIngressService(docker).observe(target, SVC);
    expect(o).toMatchObject({ state: 'error', probeFailed: true });
  });

  test('every exec is quiet and runs against hola-tailscale with the socket flag', async () => {
    const docker = new MockDockerService();
    docker.execHandler = () => ({ success: true, output: j({ BackendState: 'NeedsLogin' }) });
    const svc = new RealTailscaleIngressService(docker);
    await svc.observe(target, SVC);
    await svc.applyServe(target, { serviceName: SVC, tag: 'tag:t', mode: 'https', listenPort: 443, nodeName: 'hola-o', backend: { port: 8080 } });
    await svc.withdraw(target, SVC);
    await svc.signOut(target);
    expect(docker.composeExecCalls.length).toBe(5);
    for (const c of docker.composeExecCalls) {
      expect(c.service).toBe('hola-tailscale');
      expect(c.quiet).toBe(true);
      expect(c.command[0]).toBe('tailscale');
      expect(c.command).toContain('--socket=/tmp/tailscaled.sock');
    }
  });

  test('serve argv: https and tcp, upstream host is always the literal hola-ts-backend', () => {
    const base = { serviceName: SVC, tag: 'tag:t', listenPort: 443, nodeName: 'hola-o', backend: { port: 8080 } };
    expect(serveArgs({ ...base, mode: 'https' })).toEqual(['tailscale', '--socket=/tmp/tailscaled.sock', 'serve', `--service=${SVC}`, '--https=443', 'http://hola-ts-backend:8080']);
    expect(serveArgs({ ...base, mode: 'tcp', listenPort: 5432, backend: { port: 5432 } })).toEqual(['tailscale', '--socket=/tmp/tailscaled.sock', 'serve', `--service=${SVC}`, '--tcp=5432', 'tcp://hola-ts-backend:5432']);
  });

  test('signIn: the credential is only ever stdin; argv never carries it; tmpfs key removed even on failure', async () => {
    const docker = new MockDockerService();
    docker.execHandler = (c) => (c.command[1] === '--socket=/tmp/tailscaled.sock' && c.command[2] === 'up' ? { success: false, output: `echo ${MARKER}` } : undefined);
    const r = await new RealTailscaleIngressService(docker).signIn(target, { serviceName: SVC, tag: 'tag:hola-ingress', mode: 'https', listenPort: 443, nodeName: 'hola-omnigraph', backend: { port: 80 } }, MARKER);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(MARKER);
    const calls = docker.composeExecCalls;
    expect(calls.filter((c) => c.input !== undefined)).toHaveLength(1);
    expect(calls[0].input).toBe(MARKER);
    for (const c of calls) expect(JSON.stringify(c.command)).not.toContain(MARKER);
    expect(calls[0].command).toEqual(['sh', '-c', 'umask 077; cat > /tmp/hola-authkey']);
    expect(calls[1].command).toEqual(['tailscale', '--socket=/tmp/tailscaled.sock', 'up', '--auth-key=file:/tmp/hola-authkey', '--advertise-tags=tag:hola-ingress', '--hostname=hola-omnigraph', '--ssh=false', '--accept-routes=false', '--advertise-exit-node=false', '--advertise-routes=', '--exit-node=']);
    expect(calls[calls.length - 1].command).toEqual(['rm', '-f', '/tmp/hola-authkey']);
  });

  test('signIn with an OAuth client secret appends the persistent, pre-approved parameters (stdin only)', async () => {
    const docker = new MockDockerService();
    await new RealTailscaleIngressService(docker).signIn(target, { serviceName: SVC, tag: 'tag:t', mode: 'https', listenPort: 443, nodeName: 'hola-o', backend: { port: 80 } }, 'tskey-client-kABC-xyz');
    expect(docker.composeExecCalls[0].input).toBe('tskey-client-kABC-xyz?ephemeral=false&preauthorized=true');
    expect(JSON.stringify(docker.composeExecCalls.map((c) => c.command))).not.toContain('ephemeral');
  });

  test('a malformed stored setting (hand-edited record) never reaches argv: no exec, a named refusal', async () => {
    const good = { serviceName: SVC, tag: 'tag:t', mode: 'https' as const, listenPort: 443, nodeName: 'hola-o', backend: { port: 80 } };
    const bad = [
      { ...good, backend: { port: '80@evil.example' as unknown as number } },
      { ...good, listenPort: 70000 },
      { ...good, serviceName: 'svc:x --funnel' },
      { ...good, tag: 'tag:t,tag:admin' },
      { ...good, nodeName: 'hola-o --ssh' },
      { ...good, mode: 'funnel' as unknown as 'https' },
    ];
    for (const setting of bad) {
      const docker = new MockDockerService();
      const svc = new RealTailscaleIngressService(docker);
      expect((await svc.applyServe(target, setting)).ok).toBe(false);
      expect((await svc.signIn(target, setting, 'tskey-auth-kABC-xyz')).ok).toBe(false);
      expect(docker.composeExecCalls).toHaveLength(0);
    }
    const docker = new MockDockerService();
    expect((await new RealTailscaleIngressService(docker).withdraw(target, 'svc:x; rm')).ok).toBe(false);
    expect(docker.composeExecCalls).toHaveLength(0);
  });
});
