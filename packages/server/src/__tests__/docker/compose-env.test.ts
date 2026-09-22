/**
 * F01 — an app's Compose project must not be able to read the orchestrator's
 * environment.
 *
 * Docker Compose interpolates `${VAR}` in a bundle's compose file from the
 * environment of the process that invoked it. The production server environment
 * (packages/compose/docker-compose.yml) holds control-plane credentials — the
 * Authentik bootstrap token, an optional pre-made provisioner token, an optional
 * fixed `HOLA_API_KEY`. While every `docker compose` command inherited that
 * environment (implicitly, or by spreading `process.env`), an allowlisted-but-
 * malicious bundle could write `environment: { X: "${HOLA_AUTHENTIK_BOOTSTRAP_TOKEN}" }`
 * and be handed a live credential it was never granted (the compose validator's
 * unknown-`HOLA_*`-token check only warns).
 *
 * These tests observe the environment the child process ACTUALLY receives, by
 * putting a fake `docker` on PATH that dumps its own environment to a file.
 * Nothing is mocked at the service boundary: `RealDockerService` is driven
 * directly, so a call site that goes back to inheriting `process.env` fails here
 * even if every mock in the suite is happy.
 *
 * All credentials below are dummy strings that exist only inside this test.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { exec } from 'child_process';
import { promisify } from 'util';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { RealDockerService, appComposeEnv } from '../../services/core/docker';

const execAsync = promisify(exec);

/** Dummy platform credentials — the exact shape of the real leak, no real secret. */
const LEAKY_VARS: Record<string, string> = {
  HOLA_AUTHENTIK_BOOTSTRAP_TOKEN: 'dummy-bootstrap-should-never-leak',
  HOLA_AUTHENTIK_API_TOKEN: 'dummy-provisioner-should-never-leak',
  HOLA_API_KEY: 'dummy-admin-key-should-never-leak',
};

const COMPOSE_YML = 'services:\n  app:\n    image: busybox:1.36\n';

/** A project dir + a fake `docker` that records the env of each invocation. */
interface Harness {
  /** The compose project directory passed to RealDockerService. */
  projectPath: string;
  /** Directory prepended to PATH, holding the fake `docker`. */
  binDir: string;
  /** Where the fake `docker` dumps `env` output. */
  dumpPath: string;
  /** Parsed env of the recorded invocation (throws if `docker` never ran). */
  childEnv(): Record<string, string>;
}

function makeHarness(root: string): Harness {
  const projectPath = join(root, 'runtime');
  mkdirSync(projectPath, { recursive: true });
  writeFileSync(join(projectPath, 'docker-compose.yml'), COMPOSE_YML);

  const binDir = join(root, 'bin');
  mkdirSync(binDir, { recursive: true });
  const dumpPath = join(root, 'child-env.txt');
  // `env -0` would be tidier, but the values under test are single-line, so
  // plain `env` keeps the parser trivial. Exit 0 so the service sees success.
  writeFileSync(
    join(binDir, 'docker'),
    `#!/bin/sh\nenv > '${dumpPath}'\nexit 0\n`,
    { mode: 0o755 },
  );

  return {
    projectPath,
    binDir,
    dumpPath,
    childEnv(): Record<string, string> {
      if (!existsSync(dumpPath)) throw new Error('the fake `docker` was never invoked');
      const env: Record<string, string> = {};
      for (const line of readFileSync(dumpPath, 'utf8').split('\n')) {
        const eq = line.indexOf('=');
        if (eq > 0) env[line.slice(0, eq)] = line.slice(eq + 1);
      }
      return env;
    },
  };
}

/** Wait for the fake `docker` to have recorded a spawned (non-awaited) call. */
async function waitForDump(h: Harness, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!existsSync(h.dumpPath)) {
    if (Date.now() - start > timeoutMs) throw new Error('the fake `docker` was never invoked');
    await new Promise(r => setTimeout(r, 10));
  }
}

function expectNoPlatformCredentials(env: Record<string, string>): void {
  const serialized = Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n');
  for (const [key, value] of Object.entries(LEAKY_VARS)) {
    expect(env[key]).toBeUndefined();
    expect(serialized).not.toContain(value);
  }
  // Nothing `HOLA_*` at all: the platform passes app values through
  // `runtime/.env`, never through the child environment.
  expect(Object.keys(env).filter(k => k.startsWith('HOLA_'))).toEqual([]);
}

describe('F01: app-directed compose commands run with an allowlisted environment', () => {
  let root: string;
  let savedPath: string | undefined;
  let harness: Harness;
  let docker: RealDockerService;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'hola-compose-env-'));
    harness = makeHarness(root);
    savedPath = process.env.PATH;
    process.env.PATH = `${harness.binDir}:${process.env.PATH ?? ''}`;
    for (const [key, value] of Object.entries(LEAKY_VARS)) process.env[key] = value;
    docker = new RealDockerService();
  });

  afterEach(() => {
    if (savedPath === undefined) delete process.env.PATH;
    else process.env.PATH = savedPath;
    for (const key of Object.keys(LEAKY_VARS)) delete process.env[key];
    rmSync(root, { recursive: true, force: true });
  });

  // Every app-directed invocation in RealDockerService, including the hook
  // (`composeExec`) and restart/stop paths the security review calls out.
  test('composePull drops the parent environment', async () => {
    await docker.composePull(harness.projectPath, 'app-proj');
    expectNoPlatformCredentials(harness.childEnv());
  });

  test('composeUp drops the parent environment', async () => {
    await docker.composeUp(harness.projectPath, 'app-proj');
    expectNoPlatformCredentials(harness.childEnv());
  });

  test('composeDown drops the parent environment', async () => {
    await docker.composeDown(harness.projectPath, 'app-proj');
    expectNoPlatformCredentials(harness.childEnv());
  });

  test('composePs drops the parent environment', async () => {
    await docker.composePs(harness.projectPath, 'app-proj');
    expectNoPlatformCredentials(harness.childEnv());
  });

  test('composeRestart drops the parent environment', async () => {
    await docker.composeRestart(harness.projectPath, 'app-proj', 'app');
    expectNoPlatformCredentials(harness.childEnv());
  });

  test('composeExec (post-deploy hooks) drops the parent environment', async () => {
    await docker.composeExec(harness.projectPath, 'app-proj', 'app', ['echo', 'hi']);
    expectNoPlatformCredentials(harness.childEnv());
  });

  test('composeLogs drops the parent environment', async () => {
    await docker.composeLogs(harness.projectPath, 'app-proj');
    expectNoPlatformCredentials(harness.childEnv());
  });

  test('streamComposeLogs drops the parent environment', async () => {
    const stream = await docker.streamComposeLogs(harness.projectPath, 'app-proj', () => {});
    await waitForDump(harness);
    stream.stop();
    expectNoPlatformCredentials(harness.childEnv());
  });

  test('a private-registry pull still gets DOCKER_CONFIG, and no parent environment', async () => {
    await docker.composePull(harness.projectPath, 'app-proj', [
      { registry: 'ghcr.io', username: 'u', password: 'dummy-registry-password' },
    ]);
    const env = harness.childEnv();
    expectNoPlatformCredentials(env);
    expect(env.DOCKER_CONFIG).toBeTruthy();
    // The scoped config.json the pull authenticates with is written into that dir.
    expect(env.PATH).toContain(harness.binDir);
  });

  test('profiles still reach every lifecycle command as COMPOSE_PROFILES', async () => {
    const profiles = ['postgres', 'redis'];
    const calls: Array<() => Promise<unknown>> = [
      () => docker.composePull(harness.projectPath, 'app-proj', undefined, profiles),
      () => docker.composeUp(harness.projectPath, 'app-proj', undefined, profiles),
      () => docker.composeDown(harness.projectPath, 'app-proj', profiles),
      () => docker.composeRestart(harness.projectPath, 'app-proj', undefined, profiles),
      () => docker.composeExec(harness.projectPath, 'app-proj', 'app', ['echo'], { profiles }),
    ];
    for (const call of calls) {
      rmSync(harness.dumpPath, { force: true });
      await call();
      const env = harness.childEnv();
      expect(env.COMPOSE_PROFILES).toBe('postgres,redis');
      expectNoPlatformCredentials(env);
    }
  });

  test('no profiles: COMPOSE_PROFILES is absent, never inherited from the server', async () => {
    process.env.COMPOSE_PROFILES = 'server-side-profile';
    try {
      await docker.composeUp(harness.projectPath, 'app-proj');
      expect(harness.childEnv().COMPOSE_PROFILES).toBeUndefined();
    } finally {
      delete process.env.COMPOSE_PROFILES;
    }
  });
});

describe('appComposeEnv', () => {
  test('passes through only the allowlisted docker-client variables', () => {
    const env = appComposeEnv(undefined, {
      PATH: '/usr/bin',
      HOME: '/root',
      DOCKER_HOST: 'unix:///var/run/docker.sock',
      DOCKER_CONFIG: '/root/.docker',
      DOCKER_CONTEXT: 'default',
      DOCKER_CERT_PATH: '/certs',
      DOCKER_TLS_VERIFY: '1',
      DOCKER_API_VERSION: '1.45',
      SSH_AUTH_SOCK: '/run/ssh-agent',
      XDG_RUNTIME_DIR: '/run/user/1000',
      // Everything below must be dropped.
      HOLA_AUTHENTIK_BOOTSTRAP_TOKEN: 'dummy-bootstrap-should-never-leak',
      HOLA_API_KEY: 'dummy-admin-key-should-never-leak',
      HOLA_BASE_DOMAIN: 'example.com',
      NODE_ENV: 'production',
      AWS_SECRET_ACCESS_KEY: 'dummy',
    });

    expect(Object.keys(env).sort()).toEqual([
      'DOCKER_API_VERSION',
      'DOCKER_CERT_PATH',
      'DOCKER_CONFIG',
      'DOCKER_CONTEXT',
      'DOCKER_HOST',
      'DOCKER_TLS_VERIFY',
      'HOME',
      'PATH',
      'SSH_AUTH_SOCK',
      'XDG_RUNTIME_DIR',
    ]);
    expect(env.DOCKER_HOST).toBe('unix:///var/run/docker.sock');
  });

  test('an unset allowlisted variable is omitted rather than set empty', () => {
    // An empty `DOCKER_HOST` is not the same as no `DOCKER_HOST`: the CLI would
    // try to dial "" instead of falling back to its default socket.
    expect(appComposeEnv(undefined, { PATH: '/usr/bin' })).toEqual({ PATH: '/usr/bin' });
  });

  test('a scoped registry-auth dir overrides an inherited DOCKER_CONFIG', () => {
    const env = appComposeEnv({ dockerConfigDir: '/tmp/hola-docker-xyz' }, {
      PATH: '/usr/bin',
      DOCKER_CONFIG: '/root/.docker',
    });
    expect(env.DOCKER_CONFIG).toBe('/tmp/hola-docker-xyz');
  });

  test('profiles are comma-joined, and an empty list sets nothing', () => {
    expect(appComposeEnv({ profiles: ['a', 'b'] }, {}).COMPOSE_PROFILES).toBe('a,b');
    expect(appComposeEnv({ profiles: [] }, {}).COMPOSE_PROFILES).toBeUndefined();
    // Never inherited: the platform derives profiles per invocation (#162).
    expect(appComposeEnv(undefined, { COMPOSE_PROFILES: 'inherited' }).COMPOSE_PROFILES).toBeUndefined();
  });
});

/**
 * The reviewer's own verification, automated: render a hostile compose file with
 * REAL `docker compose config` and confirm the token cannot be resolved from the
 * environment our helper builds, while an ordinary app value still arrives from
 * the generated `runtime/.env`. Skipped (visibly) where the compose CLI is
 * absent; the hermetic tests above carry the guarantee in that case.
 */
const composeCliOk = await (async () => {
  try {
    const { stdout } = await execAsync('docker compose version --short', { timeout: 15_000 });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
})();
if (!composeCliOk) {
  console.warn('[F01] `docker compose` CLI unavailable — skipping the real-interpolation check');
}

describe.skipIf(!composeCliOk)('F01: real `docker compose config` interpolation', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'hola-compose-interp-'));
    writeFileSync(
      join(root, 'docker-compose.yml'),
      [
        'services:',
        '  app:',
        '    image: busybox:1.36',
        '    environment:',
        '      STOLEN: "${HOLA_AUTHENTIK_BOOTSTRAP_TOKEN}"',
        '      APP_SETTING: "${APP_SETTING}"',
        '',
      ].join('\n'),
    );
    // What `materializeCompose` writes next to the runtime compose file.
    writeFileSync(join(root, '.env'), 'APP_SETTING="hello from the generated dotenv"\n');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  async function renderWith(env: NodeJS.ProcessEnv): Promise<string> {
    const { stdout } = await execAsync(
      'docker compose -f docker-compose.yml -p hola-f01-probe config',
      { cwd: root, env, timeout: 60_000 },
    );
    return stdout;
  }

  test('the parent token does not interpolate, and the app value does', async () => {
    const parent = { ...process.env, HOLA_AUTHENTIK_BOOTSTRAP_TOKEN: 'dummy-bootstrap-should-never-leak' };
    const rendered = await renderWith(appComposeEnv(undefined, parent));

    expect(rendered).not.toContain('dummy-bootstrap-should-never-leak');
    expect(rendered).toContain('hello from the generated dotenv');
  });
});
