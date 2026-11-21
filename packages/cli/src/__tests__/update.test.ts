import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { runUpdate, fetchReleaseNotes, type UpdateResult, type UpdateCheckReport } from '../commands/update/update';
import { scriptedPrompter } from '../install/prompter';
import type { Runner } from '../lib/runner';

const OK_PREFLIGHT = 'docker=ok\ncurl=ok\ntar=ok\ncompose=ok\ndockerperm=ok\n';

export const OK_ACCESS =
  '__HOLA_ACCESS__\nuser=me\ngroup=me\nuid=1000\ndir=ok\nowner=me\ndirowned=ok\ndirwritable=ok\nenv=ok\n';

const ENV_AUTHENTIK =
  'HOLA_DOMAIN=apps.example.com\nHOLA_BASE_DOMAIN=hola.example.com\nHOLA_AUTH_MODE=authentik\nHOLA_AUTHENTIK_DOMAIN=auth.hola.example.com\n';
const ENV_NONE = 'HOLA_DOMAIN=apps.example.com\nHOLA_BASE_DOMAIN=hola.example.com\nHOLA_AUTH_MODE=none\n';

const EXAMPLE_BASE = 'HOLA_DOMAIN=\nHOLA_BASE_DOMAIN=\nHOLA_AUTH_MODE=authentik\n';

function makeRunner(opts?: {
  preflight?: string;
  env?: string;
  version?: string;
  /** The .env.example shipped by the OLD (installed) bundle, read before extract. */
  oldExample?: string;
  /** The .env.example shipped by the NEW bundle, read after extract. */
  newExample?: string;
  /** Canned output for the install-dir access probe (defaults to a healthy, owned dir). */
  access?: string;
}): Runner & { calls: { cmd: string; input?: string }[] } {
  const preflight = opts?.preflight ?? OK_PREFLIGHT;
  const env = opts?.env ?? ENV_AUTHENTIK;
  const version = opts?.version ?? '0.6.20';
  const oldExample = opts?.oldExample ?? EXAMPLE_BASE;
  const newExample = opts?.newExample ?? EXAMPLE_BASE;
  const calls: { cmd: string; input?: string }[] = [];
  return {
    calls,
    ssh: vi.fn(async (_host: string, cmd: string, o?: { input?: string }) => {
      calls.push({ cmd, input: o?.input });
      if (cmd.includes('__HOLA_ACCESS__')) return { code: 0, stdout: opts?.access ?? OK_ACCESS, stderr: '' };
      if (cmd.includes('command -v')) return { code: 0, stdout: preflight, stderr: '' };
      // Pre-upgrade snapshot: echo back the archive path behind its marker.
      if (cmd.includes('HOLA_BACKUP_PATH=')) {
        return { code: 0, stdout: 'HOLA_BACKUP_PATH=/opt/hola/backups/pre-update-0.6.20-20260101T000000Z.tar.gz\n', stderr: '' };
      }
      // The combined state read (version + old .env.example + .env) is matched first.
      if (cmd.includes('__HOLA_ENV__')) {
        return { code: 0, stdout: `__HOLA_VERSION__=${version}\n__HOLA_EXAMPLE__\n${oldExample}\n__HOLA_ENV__\n${env}`, stderr: '' };
      }
      if (cmd.includes('.env.example')) return { code: 0, stdout: newExample, stderr: '' };
      if (cmd.includes('cat') && cmd.includes('/VERSION')) return { code: 0, stdout: version, stderr: '' };
      if (cmd.includes('compose ps')) return { code: 0, stdout: '', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    }),
    local: vi.fn(async () => ({ code: 0, stdout: '', stderr: '' })),
  } as Runner & { calls: { cmd: string; input?: string }[] };
}

describe('hola update', () => {
  beforeEach(() => { process.exitCode = 0; });
  afterEach(() => { process.exitCode = 0; });

  it('runs the upgrade steps in order without writing the .env', async () => {
    const runner = makeRunner();
    const res = (await runUpdate(
      { host: 'me@vm', ref: 'cli-v0.6.23', json: true },
      { prompter: scriptedPrompter({}), runner },
    )) as UpdateResult;

    expect(res.steps).toEqual([
      'Preflight host',
      'Check install dir access',
      'Read current install',
      'Snapshot current install (.env, traefik/acme, hola-data)',
      'Download Hola 0.6.23 stack into /opt/hola',
      'Check config drift (.env.example vs .env)',
      'Run install.sh',
    ]);
    // No `.env` is ever rewritten — it's preserved in place.
    expect(runner.calls.some((c) => c.cmd.includes('cat > /opt/hola/.env'))).toBe(false);
    expect(res.fromVersion).toBe('0.6.20');
    expect(res.toVersion).toBe('0.6.23');
    expect(res.ssoAction).toBe('already-on');
    expect(res.backupPath).toBe('/opt/hola/backups/pre-update-0.6.20-20260101T000000Z.tar.gz');
    expect(process.exitCode).toBe(0);
  });

  it('downloads the version-pinned bundle and extracts over the dir (no .env, no acme)', async () => {
    const runner = makeRunner();
    await runUpdate(
      { host: 'me@vm', ref: 'cli-v0.6.23', dir: '/opt/hola', json: true },
      { prompter: scriptedPrompter({}), runner },
    );
    const fetch = runner.calls.find((c) => c.cmd.includes('"$own" -C "$d"'))!;
    expect(fetch.cmd).toMatch(/curl -fsSL -o "\$tmp" \S*releases\/download\/cli-v0\.6\.23\/hola-compose-0\.6\.23\.tar\.gz/);
    // Update never creates the dir (it must already exist) — no mkdir/sudo dance.
    expect(fetch.cmd).not.toContain('mkdir -p');
    expect(fetch.cmd).toContain('d=/opt/hola');
  });

  it('honors --tarball-url', async () => {
    const runner = makeRunner();
    await runUpdate(
      { host: 'me@vm', tarballUrl: 'https://example.com/custom.tar.gz', json: true },
      { prompter: scriptedPrompter({}), runner },
    );
    expect(runner.calls.some((c) => c.cmd.includes('curl -fsSL -o "$tmp" https://example.com/custom.tar.gz'))).toBe(true);
  });

  it('aborts when no install (.env) is found on the host', async () => {
    const runner = makeRunner({ env: '' });
    const res = await runUpdate(
      { host: 'me@vm', json: true },
      { prompter: scriptedPrompter({}), runner },
    );
    expect(res).toBeUndefined();
    expect(process.exitCode).toBe(1);
    expect(runner.calls.some((c) => c.cmd.includes('install.sh'))).toBe(false);
  });

  it('aborts before install when preflight finds Docker missing', async () => {
    const runner = makeRunner({ preflight: 'docker=missing\ncurl=ok\ntar=ok\ncompose=missing\ndockerperm=fail\n' });
    const res = await runUpdate({ host: 'me@vm', json: true }, { prompter: scriptedPrompter({}), runner });
    expect(res).toBeUndefined();
    expect(process.exitCode).toBe(1);
    expect(runner.calls.some((c) => c.cmd.includes('install.sh'))).toBe(false);
  });

  it('requires --host', async () => {
    const res = await runUpdate({ json: true }, { prompter: scriptedPrompter({}), runner: makeRunner() });
    expect(res).toBeUndefined();
    expect(process.exitCode).toBe(1);
  });

  it('--dry-run connects to nothing and exits 0', async () => {
    const runner = makeRunner();
    const res = (await runUpdate(
      { host: 'me@vm', dryRun: true, json: true },
      { prompter: scriptedPrompter({}), runner },
    )) as UpdateResult;
    expect(runner.calls).toHaveLength(0);
    expect(res.steps.length).toBeGreaterThan(0);
    expect(process.exitCode).toBe(0);
  });

  // --- Auth-mode reconciliation (issue #149) --------------------------------

  it('explicit HOLA_AUTH_MODE=none + --enable-sso flips the mode and derives the domain', async () => {
    const runner = makeRunner({ env: ENV_NONE });
    const res = (await runUpdate(
      { host: 'me@vm', enableSso: true, json: true },
      { prompter: scriptedPrompter({}), runner },
    )) as UpdateResult;
    expect(res.ssoAction).toBe('enabled');
    const setEnv = runner.calls.find((c) => c.cmd.includes('_set HOLA_AUTH_MODE'))!;
    expect(setEnv.cmd).toContain('_set HOLA_AUTH_MODE authentik');
    // Domain derived from HOLA_BASE_DOMAIN since the .env had none.
    expect(setEnv.cmd).toContain('_set HOLA_AUTHENTIK_DOMAIN auth.hola.example.com');
  });

  it('explicit HOLA_AUTH_MODE=none + --keep-auth-mode keeps it off and writes no env change', async () => {
    const runner = makeRunner({ env: ENV_NONE });
    const res = (await runUpdate(
      { host: 'me@vm', keepAuthMode: true, json: true },
      { prompter: scriptedPrompter({}), runner },
    )) as UpdateResult;
    expect(res.ssoAction).toBe('kept-none');
    expect(runner.calls.some((c) => c.cmd.includes('_set HOLA_AUTH_MODE'))).toBe(false);
  });

  it('explicit none under --json with no decision flag aborts', async () => {
    const runner = makeRunner({ env: ENV_NONE });
    const res = await runUpdate({ host: 'me@vm', json: true }, { prompter: scriptedPrompter({}), runner });
    expect(res).toBeUndefined();
    expect(process.exitCode).toBe(1);
    expect(runner.calls.some((c) => c.cmd.includes('install.sh'))).toBe(false);
  });

  it('--enable-sso and --keep-auth-mode together is rejected', async () => {
    const runner = makeRunner({ env: ENV_NONE });
    const res = await runUpdate(
      { host: 'me@vm', enableSso: true, keepAuthMode: true, json: true },
      { prompter: scriptedPrompter({}), runner },
    );
    expect(res).toBeUndefined();
    expect(process.exitCode).toBe(1);
  });

  // --- Pre-upgrade snapshot (#284) ------------------------------------------

  it('snapshots .env + traefik/acme + the hola-data volume before downloading the new bundle', async () => {
    const runner = makeRunner();
    await runUpdate({ host: 'me@vm', json: true }, { prompter: scriptedPrompter({}), runner });
    const backup = runner.calls.find((c) => c.cmd.includes('HOLA_BACKUP_PATH='))!;
    expect(backup).toBeDefined();
    // Captures the platform-tier rollback surface: operator config, the ACME cert
    // store, and the hola-data volume (via docker cp from the running server).
    expect(backup.cmd).toContain('/opt/hola/.env');
    expect(backup.cmd).toContain('/opt/hola/traefik/acme');
    expect(backup.cmd).toContain('docker cp hola-server:/data');
    expect(backup.cmd).toContain('/opt/hola/backups');
    // App-data binds are NOT included unless asked.
    expect(backup.cmd).not.toContain('/srv/hola/apps');
    // The snapshot precedes the bundle download (the rollback point is the pre-upgrade state).
    const order = runner.calls.map((c) => c.cmd);
    expect(order.findIndex((c) => c.includes('HOLA_BACKUP_PATH='))).toBeLessThan(
      order.findIndex((c) => c.includes('--no-same-owner')),
    );
  });

  it('--no-backup (backup=false) skips the snapshot entirely', async () => {
    const runner = makeRunner();
    const res = (await runUpdate(
      { host: 'me@vm', backup: false, json: true },
      { prompter: scriptedPrompter({}), runner },
    )) as UpdateResult;
    expect(runner.calls.some((c) => c.cmd.includes('HOLA_BACKUP_PATH='))).toBe(false);
    expect(res.steps).not.toContain('Snapshot current install (.env, traefik/acme, hola-data)');
    expect(res.backupPath).toBeNull();
    // The upgrade still proceeds.
    expect(runner.calls.some((c) => c.cmd.includes('install.sh'))).toBe(true);
  });

  it('--backup-app-data also tars the app-data bind root', async () => {
    const runner = makeRunner();
    await runUpdate(
      { host: 'me@vm', backupAppData: true, json: true },
      { prompter: scriptedPrompter({}), runner },
    );
    const backup = runner.calls.find((c) => c.cmd.includes('HOLA_BACKUP_PATH='))!;
    expect(backup.cmd).toContain('/srv/hola/apps');
    expect(backup.cmd).toContain('-C "/srv/hola" "apps"');
  });

  it('honors HOLA_APPS_BIND_ROOT from the host .env for --backup-app-data', async () => {
    const runner = makeRunner({ env: `${ENV_AUTHENTIK}HOLA_APPS_BIND_ROOT=/data/hola/apps\n` });
    await runUpdate(
      { host: 'me@vm', backupAppData: true, json: true },
      { prompter: scriptedPrompter({}), runner },
    );
    const backup = runner.calls.find((c) => c.cmd.includes('HOLA_BACKUP_PATH='))!;
    expect(backup.cmd).toContain('-C "/data/hola" "apps"');
  });

  it('fail-closed: a snapshot failure aborts before downloading the new bundle', async () => {
    const runner = makeRunner();
    // Make the snapshot command fail.
    const origSsh = runner.ssh;
    runner.ssh = vi.fn(async (host: string, cmd: string, o?: { input?: string }) => {
      if (cmd.includes('HOLA_BACKUP_PATH=')) {
        runner.calls.push({ cmd, input: o?.input });
        return { code: 1, stdout: '', stderr: 'no space left on device' };
      }
      return origSsh(host, cmd, o);
    }) as typeof runner.ssh;
    const res = await runUpdate({ host: 'me@vm', json: true }, { prompter: scriptedPrompter({}), runner });
    expect(res).toBeUndefined();
    expect(process.exitCode).toBe(1);
    // No bundle download and no install.sh after a failed snapshot.
    expect(runner.calls.some((c) => c.cmd.includes('tar xz -C /opt/hola'))).toBe(false);
    expect(runner.calls.some((c) => c.cmd.includes('install.sh'))).toBe(false);
  });

  // --- Config drift ---------------------------------------------------------

  it('warns only about genuinely new required keys (not auto-managed or defaulted ones)', async () => {
    const runner = makeRunner({
      // This release adds a new blank required key plus an auto-managed Authentik secret.
      newExample: `${EXAMPLE_BASE}HOLA_NEW_THING=\nAUTHENTIK_NEW_SECRET=\nHOLA_WITH_DEFAULT=somevalue\n`,
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await runUpdate({ host: 'me@vm' }, { prompter: scriptedPrompter({}), runner });
      const printed = log.mock.calls.map((c) => String(c[0])).join('\n');
      expect(printed).toContain('HOLA_NEW_THING');
      // Auto-managed (install.sh generates it) and defaulted keys are NOT flagged.
      expect(printed).not.toContain('AUTHENTIK_NEW_SECRET');
      expect(printed).not.toContain('HOLA_WITH_DEFAULT');
    } finally {
      log.mockRestore();
    }
  });

  it('does not warn on a same-version re-run (old and new .env.example match)', async () => {
    const runner = makeRunner();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await runUpdate({ host: 'me@vm' }, { prompter: scriptedPrompter({}), runner });
      const printed = log.mock.calls.map((c) => String(c[0])).join('\n');
      expect(printed).not.toContain('New required config');
    } finally {
      log.mockRestore();
    }
  });

  // --- CLI self-update before the server update -----------------------------

  const NEWER = async () => ({ version: '9.9.9', url: 'https://example.com/r' });

  it('self-updates the CLI (when newer) before updating the server', async () => {
    const runner = makeRunner();
    const selfUpdate = vi.fn(async () => 'skipped' as const);
    await runUpdate(
      { host: 'me@vm', json: true },
      { prompter: scriptedPrompter({}), runner, fetchLatest: NEWER, selfUpdate },
    );
    expect(selfUpdate).toHaveBeenCalledWith(expect.objectContaining({ latestVersion: '9.9.9' }));
    // It still proceeds to the server update afterwards.
    expect(runner.calls.some((c) => c.cmd.includes('install.sh'))).toBe(true);
  });

  it('--no-self-update (selfUpdate=false) skips the CLI self-update', async () => {
    const runner = makeRunner();
    const selfUpdate = vi.fn(async () => 'skipped' as const);
    await runUpdate(
      { host: 'me@vm', selfUpdate: false, json: true },
      { prompter: scriptedPrompter({}), runner, fetchLatest: NEWER, selfUpdate },
    );
    expect(selfUpdate).not.toHaveBeenCalled();
    expect(runner.calls.some((c) => c.cmd.includes('install.sh'))).toBe(true);
  });

  it('a pinned --ref skips the CLI self-update', async () => {
    const runner = makeRunner();
    const selfUpdate = vi.fn(async () => 'skipped' as const);
    await runUpdate(
      { host: 'me@vm', ref: 'cli-v0.6.25', json: true },
      { prompter: scriptedPrompter({}), runner, fetchLatest: NEWER, selfUpdate },
    );
    expect(selfUpdate).not.toHaveBeenCalled();
  });

  it('aborts (before touching the host) when the CLI binary is not writable', async () => {
    const runner = makeRunner();
    const selfUpdate = vi.fn(async () => 'not-writable' as const);
    const res = await runUpdate(
      { host: 'me@vm', json: true },
      { prompter: scriptedPrompter({}), runner, fetchLatest: NEWER, selfUpdate },
    );
    expect(res).toBeUndefined();
    expect(process.exitCode).toBe(1);
    expect(runner.calls.some((c) => c.cmd.includes('install.sh'))).toBe(false);
  });

  // --- `--check` ------------------------------------------------------------

  it('--check reports installed / latest / updateAvailable without mutating', async () => {
    const runner = makeRunner({ version: '0.6.20' });
    const res = (await runUpdate(
      { host: 'me@vm', check: true, json: true },
      { prompter: scriptedPrompter({}), runner, fetchLatest: async () => ({ version: '0.6.25', url: 'https://example.com/r' }) },
    )) as UpdateCheckReport;
    expect(res.installed).toBe('0.6.20');
    expect(res.latest).toBe('0.6.25');
    expect(res.updateAvailable).toBe(true);
    expect(res.releaseUrl).toBe('https://example.com/r');
    // No install/extract happened.
    expect(runner.calls.some((c) => c.cmd.includes('install.sh') || c.cmd.includes('tar '))).toBe(false);
  });

  // --- #599: ownership preflight + accurate errors -------------------------

  /** Run an update and return what it wrote to stderr (the abort message). */
  async function failure(
    runner: Runner,
    extra: Partial<Parameters<typeof runUpdate>[0]> = {},
  ): Promise<string> {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await runUpdate(
        { host: 'me@vm', ref: 'cli-v0.6.23', json: true, ...extra },
        { prompter: scriptedPrompter({}), runner },
      );
      expect(res).toBeUndefined();
      expect(process.exitCode).toBe(1);
      return err.mock.calls.map((c) => String(c[0])).join('\n');
    } finally {
      err.mockRestore();
    }
  }

  /** Wrap a runner so `fn` can answer a command; returning undefined falls through to the original. */
  function override(runner: Runner, fn: (cmd: string) => { code: number; stdout: string; stderr: string } | undefined): void {
    const orig = runner.ssh.bind(runner);
    runner.ssh = async (h, cmd, o) => fn(cmd) ?? orig(h, cmd, o);
  }

  const accessOut = (lines: string) => `__HOLA_ACCESS__\nuser=me\ngroup=staff\nuid=1000\ndir=ok\nowner=root\n${lines}`;

  it('stops before changing anything when the dir is owned by another user, naming the real fix', async () => {
    const runner = makeRunner({
      access: accessOut('dirowned=fail\ndirwritable=fail\nenv=ok\nforeign=/opt/hola/VERSION\nforeign=/opt/hola/scripts\n'),
    });
    const msg = await failure(runner);
    expect(msg).toContain('/opt/hola is owned by root, not me');
    expect(msg).toContain('me cannot write to /opt/hola');
    expect(msg).toContain('/opt/hola/VERSION');
    // Primary group comes from `id -gn` on the host, not an assumed same-as-user group.
    expect(msg).toContain('sudo chown -R me:staff /opt/hola');
    expect(runner.calls.some((c) => c.cmd.includes('curl -fsSL') || c.cmd.includes('HOLA_BACKUP_PATH') || c.cmd.includes('install.sh'))).toBe(false);
  });

  it('reports an unreadable .env from the preflight, naming the file and user', async () => {
    const msg = await failure(makeRunner({ access: accessOut('dirowned=ok\ndirwritable=ok\nenv=unreadable\n') }));
    expect(msg).toContain('me cannot read /opt/hola/.env (permission denied)');
    expect(msg).not.toContain('Could not connect');
  });

  it('reports a blocked subdirectory', async () => {
    const msg = await failure(makeRunner({ access: accessOut('dirowned=ok\ndirwritable=ok\nenv=ok\nblocked=scripts\n') }));
    expect(msg).toContain('/opt/hola/scripts is not owned or writable by me');
  });

  it('passes for root (uid 0 reports owned + writable) and does not nag about foreign files', async () => {
    const runner = makeRunner({
      access: '__HOLA_ACCESS__\nuser=root\ngroup=root\nuid=0\ndir=ok\nowner=1001\ndirowned=ok\ndirwritable=ok\nenv=ok\nforeign=/opt/hola/VERSION\n',
    });
    const res = await runUpdate(
      { host: 'root@vm', ref: 'cli-v0.6.23', json: true },
      { prompter: scriptedPrompter({}), runner },
    );
    expect(res).toBeDefined();
    expect(process.exitCode).toBe(0);
  });

  it('quotes an install dir containing spaces in every remote command', async () => {
    const runner = makeRunner();
    await runUpdate(
      { host: 'me@vm', ref: 'cli-v0.6.23', dir: "/srv/my hola's", json: true },
      { prompter: scriptedPrompter({}), runner },
    );
    const q = "'/srv/my hola'\\''s'";
    expect(runner.calls.find((c) => c.cmd.includes('__HOLA_ACCESS__'))!.cmd).toContain(`d=${q}`);
    expect(runner.calls.find((c) => c.cmd.includes('__HOLA_ENV__'))!.cmd).toContain(`cat ${q}/.env`);
    expect(runner.calls.find((c) => c.cmd.includes('--no-same-owner'))!.cmd).toContain(`d=${q}`);
    expect(runner.calls.find((c) => c.cmd.includes('install.sh'))!.cmd).toContain(`cd ${q} &&`);
  });

  it('a missing install dir is reported as no install, with the bootstrap hint', async () => {
    const msg = await failure(makeRunner({ access: '__HOLA_ACCESS__\nuser=me\ngroup=me\nuid=1000\ndir=missing\n' }));
    expect(msg).toContain('No Hola install found at /opt/hola');
    expect(msg).toContain('hola bootstrap --host me@vm');
  });

  it('ssh exit 255 on a step is a connection failure', async () => {
    const runner = makeRunner();
    (runner.ssh as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => ({ code: 255, stdout: '', stderr: 'ssh: connect to host vm port 22: Connection refused' }));
    const msg = await failure(runner);
    expect(msg).toContain('Could not connect to me@vm (ssh exit 255)');
    expect(msg).toContain('Connection refused');
  });

  it('a non-255 exit on a step names the step, not the connection', async () => {
    const runner = makeRunner();
    (runner.ssh as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => ({ code: 1, stdout: '', stderr: 'cat: /opt/hola/VERSION: Permission denied' }));
    const msg = await failure(runner);
    expect(msg).not.toContain('Could not connect');
    expect(msg).toContain('"Preflight host" failed on me@vm (exit 1)');
    expect(msg).toContain('Permission denied');
  });

  it('an unreadable .env at the read step names the file, not the connection', async () => {
    const runner = makeRunner();
    override(runner, (cmd) =>
      cmd.includes('__HOLA_ENV__')
        ? { code: 0, stdout: '__HOLA_VERSION__=0.6.20\n__HOLA_EXAMPLE__\n\n__HOLA_ENV__\n__HOLA_ENV_UNREADABLE__\n', stderr: '' }
        : undefined,
    );
    const msg = await failure(runner);
    expect(msg).toContain('Could not read /opt/hola/.env on me@vm: permission denied');
    expect(msg).toContain('sudo chown -R');
    expect(msg).not.toContain('Could not connect');
  });

  it('never echoes .env contents into an error', async () => {
    const runner = makeRunner();
    (runner.ssh as ReturnType<typeof vi.fn>).mockImplementation(async (_h: string, cmd: string) => {
      if (cmd.includes('__HOLA_ACCESS__')) return { code: 0, stdout: OK_ACCESS, stderr: '' };
      if (cmd.includes('command -v')) return { code: 0, stdout: OK_PREFLIGHT, stderr: '' };
      return { code: 3, stdout: 'POSTGRES_PASSWORD=hunter2\n', stderr: 'boom' };
    });
    const msg = await failure(runner);
    expect(msg).toContain('boom');
    expect(msg).not.toContain('hunter2');
  });

  const stepFailure = (code: number, stderr: string) => {
    const runner = makeRunner();
    override(runner, (cmd) => (cmd.includes('--no-same-owner') ? { code, stdout: '', stderr } : undefined));
    return runner;
  };

  it('a failed download blames the download and shows curl output', async () => {
    const msg = await failure(stepFailure(42, 'curl: (22) The requested URL returned error: 404'));
    expect(msg).toContain('Downloading the compose bundle failed');
    expect(msg).toContain('Check that release cli-v0.6.23 exists');
    expect(msg).toContain('returned error: 404');
  });

  it('a failed extract blames the extract, shows tar output, and does NOT say "check the release"', async () => {
    const msg = await failure(stepFailure(43, 'tar: ./VERSION: Cannot open: File exists'));
    expect(msg).toContain('could not extract it into /opt/hola');
    expect(msg).toContain('Cannot open: File exists');
    expect(msg).not.toContain('Check that release');
  });

  it('an ssh drop during the download is a connection failure', async () => {
    const msg = await failure(stepFailure(255, 'client_loop: send disconnect: Broken pipe'));
    expect(msg).toContain('Could not connect to me@vm (ssh exit 255)');
    expect(msg).not.toContain('Check that release');
  });

  it('the extract command never restores owners', async () => {
    const runner = makeRunner();
    await runUpdate({ host: 'me@vm', ref: 'cli-v0.6.23', json: true }, { prompter: scriptedPrompter({}), runner });
    const cmd = runner.calls.find((c) => c.cmd.includes('--no-same-owner'))!.cmd;
    expect(cmd).toContain('own=--no-same-owner');
    expect(cmd).not.toMatch(/\| *tar/);
  });

  it('--check labels the latest as stable when running a prerelease', async () => {
    const logs: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((m) => { logs.push(String(m)); });
    try {
      const res = (await runUpdate(
        { host: 'me@vm', check: true },
        { prompter: scriptedPrompter({}), runner: makeRunner({ version: '0.11.0-rc.14' }), fetchLatest: async () => ({ version: '0.10.0', url: 'u' }) },
      )) as UpdateCheckReport;
      expect(res.latest).toBe('0.10.0'); // JSON field names/values unchanged
    } finally { log.mockRestore(); }
    expect(logs.join('\n')).toContain('Latest stable release:');
  });

  it('--check keeps the plain label for stable installs', async () => {
    const logs: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((m) => { logs.push(String(m)); });
    try {
      await runUpdate(
        { host: 'me@vm', check: true },
        { prompter: scriptedPrompter({}), runner: makeRunner({ version: '0.6.20' }), fetchLatest: async () => ({ version: '0.6.25', url: 'u' }) },
      );
    } finally { log.mockRestore(); }
    const out = logs.join('\n');
    expect(out).toContain('Latest release:');
    expect(out).not.toContain('stable');
  });

  // --- post-update changelog ------------------------------------------------

  const notesResponse = (body: unknown) =>
    ({ ok: true, json: async () => ({ body, html_url: 'https://example.com/rel' }) }) as unknown as Response;

  it('fetchReleaseNotes returns only the changelog portion before the install sentinel', async () => {
    const body = "## What's Changed\n- feat: a (#1)\n- fix: b (#2)\n\n<!-- hola:changelog-end -->\nInstall with: ...";
    const fetchImpl = (async () => notesResponse(body)) as unknown as typeof fetch;
    const r = await fetchReleaseNotes('https://github.com/try-hola/hola.git', '0.6.36', fetchImpl);
    expect(r).toEqual({ notes: "## What's Changed\n- feat: a (#1)\n- fix: b (#2)", url: 'https://example.com/rel' });
  });

  it('fetchReleaseNotes returns null for a release with no sentinel (older release)', async () => {
    const fetchImpl = (async () => notesResponse('Standalone `hola` CLI binaries. Install with: ...')) as unknown as typeof fetch;
    expect(await fetchReleaseNotes('https://github.com/try-hola/hola.git', '0.6.1', fetchImpl)).toBeNull();
  });

  it('prints the "What\'s new" changelog at the end of a successful update', async () => {
    const runner = makeRunner();
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((m?: unknown) => { logs.push(String(m)); });
    try {
      await runUpdate(
        { host: 'me@vm', ref: 'cli-v0.6.23' },
        {
          prompter: scriptedPrompter({}),
          runner,
          fetchNotes: async (_repo, version) => ({ notes: `- feat: shiny (#7)\n- fix: bug (#8)`, url: `https://example.com/cli-v${version}` }),
        },
      );
    } finally {
      spy.mockRestore();
    }
    const out = logs.join('\n');
    expect(out).toContain("What's new in v0.6.23");
    expect(out).toContain('- feat: shiny (#7)');
    expect(out).toContain('Full notes: https://example.com/cli-v0.6.23');
  });
});
