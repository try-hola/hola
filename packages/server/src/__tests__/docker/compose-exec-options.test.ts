/**
 * Spec 010 (T007): `composeExec` stdin `input` / `quiet` / `timeoutMs`, and the
 * new removal methods. A fake `docker` on PATH records argv and stdin, so these
 * observe what the child process really received, not a mock's idea of it.
 */
import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { RealDockerService, MockDockerService } from '../../services/core/docker';

const SECRET = 'tskey-auth-kMARKERSECRET-zzzzzzzz';

let root: string;
let origPath: string | undefined;
let logged: string[];
let spies: Array<{ mockRestore: () => void }>;

function setup(fakeBody: string) {
  root = mkdtempSync(join(tmpdir(), 'hola-exec-'));
  const project = join(root, 'p');
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, 'docker-compose.yml'), 'services:\n  a:\n    image: busybox:1.36\n');
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'docker'), `#!/bin/sh\n${fakeBody}\n`, { mode: 0o755 });
  origPath = process.env.PATH;
  process.env.PATH = `${bin}:${origPath}`;
  return project;
}

beforeEach(() => {
  logged = [];
  spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
    spyOn(console, m).mockImplementation((...a: unknown[]) => {
      logged.push(a.map(String).join(' '));
    }),
  );
});
afterEach(() => {
  for (const s of spies) s.mockRestore();
  if (origPath !== undefined) process.env.PATH = origPath;
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('RealDockerService.composeExec (spec 010)', () => {
  test('input goes to stdin, never argv; quiet logs no output on success', async () => {
    const project = setup(`:`);
    // placeholders resolved now that the temp root exists
    writeFileSync(
      join(root, 'bin', 'docker'),
      `#!/bin/sh\nprintf '%s\\n' "$@" > '${join(root, 'argv')}'\ncat > '${join(root, 'stdin')}'\necho "child said ${SECRET}"\n`,
      { mode: 0o755 },
    );
    const svc = new RealDockerService();
    const r = await svc.composeExec(project, 'proj', 'hola-tailscale', ['sh', '-c', 'cat > /tmp/k'], {
      input: SECRET,
      quiet: true,
    });
    expect(r.success).toBe(true);
    expect(readFileSync(join(root, 'stdin'), 'utf8')).toBe(SECRET);
    const argv = readFileSync(join(root, 'argv'), 'utf8');
    expect(argv).not.toContain(SECRET);
    expect(argv).toContain('exec');
    expect(argv).toContain('-T');
    expect(argv).toContain('hola-tailscale');
    // quiet: the child's output (which here echoes the secret) is returned but never logged
    expect(r.output).toContain(SECRET);
    expect(logged.join('\n')).not.toContain(SECRET);
    expect(logged.join('\n')).toContain('hola-tailscale');
  });

  test('quiet logs no output on failure either', async () => {
    const project = setup(`cat > /dev/null\necho "boom ${SECRET}" >&2\nexit 3`);
    const svc = new RealDockerService();
    const r = await svc.composeExec(project, 'proj', 'svc', ['x'], { input: 'v', quiet: true });
    expect(r.success).toBe(false);
    expect(logged.join('\n')).not.toContain(SECRET);
    expect(logged.join('\n')).toContain('Compose exec failed');
  });

  test('without quiet, output is logged as before', async () => {
    const project = setup(`echo visible-output`);
    const svc = new RealDockerService();
    await svc.composeExec(project, 'proj', 'svc', ['x']);
    expect(logged.join('\n')).toContain('visible-output');
  });

  test('timeoutMs is honoured', async () => {
    const project = setup(`sleep 5`);
    const svc = new RealDockerService();
    const t0 = Date.now();
    const r = await svc.composeExec(project, 'proj', 'svc', ['x'], { timeoutMs: 300, quiet: true });
    expect(r.success).toBe(false);
    expect(Date.now() - t0).toBeLessThan(4000);
  });
});

describe('RealDockerService removals (spec 010)', () => {
  test('composeRemoveService runs `compose rm -s -f <service>` with argv', async () => {
    const project = setup(`:`);
    writeFileSync(join(root, 'bin', 'docker'), `#!/bin/sh\nprintf '%s\\n' "$@" > '${join(root, 'argv')}'\n`, { mode: 0o755 });
    const r = await new RealDockerService().composeRemoveService(project, 'proj', 'hola-tailscale');
    expect(r.success).toBe(true);
    const argv = readFileSync(join(root, 'argv'), 'utf8').trim().split('\n');
    expect(argv.slice(-4)).toEqual(['rm', '-s', '-f', 'hola-tailscale']);
  });

  test('removeVolume / removeNetwork succeed when the object is absent, fail on other errors', async () => {
    setup(`echo "Error response from daemon: get x: no such volume" >&2\nexit 1`);
    const svc = new RealDockerService();
    expect((await svc.removeVolume('x')).success).toBe(true);
    expect((await svc.removeNetwork('x')).success).toBe(true);
    writeFileSync(join(root, 'bin', 'docker'), `#!/bin/sh\necho "volume is in use" >&2\nexit 1\n`, { mode: 0o755 });
    expect((await svc.removeVolume('x')).success).toBe(false);
  });

  test('removeVolume passes the name as one argv element', async () => {
    setup(`:`);
    writeFileSync(join(root, 'bin', 'docker'), `#!/bin/sh\nprintf '%s\\n' "$@" > '${join(root, 'argv')}'\n`, { mode: 0o755 });
    await new RealDockerService().removeVolume('proj_hola-ts-state');
    expect(readFileSync(join(root, 'argv'), 'utf8').trim().split('\n')).toEqual(['volume', 'rm', 'proj_hola-ts-state']);
    expect(existsSync(join(root, 'argv'))).toBe(true);
  });
});

describe('MockDockerService (spec 010)', () => {
  test('records exec argv/input and removals in order, with scriptable results', async () => {
    const m = new MockDockerService();
    m.execHandler = (c) => (c.command[0] === 'fail' ? { success: false, output: 'nope' } : undefined);
    await m.composeExec('/p', 'proj', 'hola-tailscale', ['a', 'b'], { input: 'in', quiet: true });
    expect((await m.composeExec('/p', 'proj', 's', ['fail'])).success).toBe(false);
    expect(m.composeExecCalls[0]).toMatchObject({ service: 'hola-tailscale', command: ['a', 'b'], input: 'in', quiet: true });
    await m.composeRemoveService('/p', 'proj', 'hola-tailscale');
    await m.removeVolume('v');
    await m.removeNetwork('n');
    expect(m.removalCalls.map((c) => c.kind)).toEqual(['service', 'volume', 'network']);
  });
});
