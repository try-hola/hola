import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { runUpdate, fetchReleaseNotes, type UpdateResult, type UpdateCheckReport } from '../commands/update/update';
import { scriptedPrompter } from '../install/prompter';
import type { Runner } from '../lib/runner';

const OK_PREFLIGHT = 'docker=ok\ncurl=ok\ntar=ok\ncompose=ok\ndockerperm=ok\n';

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
    const fetch = runner.calls.find((c) => c.cmd.includes('tar xz -C /opt/hola'))!;
    expect(fetch.cmd).toMatch(/curl -fsSL \S*releases\/download\/cli-v0\.6\.23\/hola-compose-0\.6\.23\.tar\.gz/);
    // Update never creates the dir (it must already exist) — no mkdir/sudo dance.
    expect(fetch.cmd).not.toContain('mkdir');
  });

  it('honors --tarball-url', async () => {
    const runner = makeRunner();
    await runUpdate(
      { host: 'me@vm', tarballUrl: 'https://example.com/custom.tar.gz', json: true },
      { prompter: scriptedPrompter({}), runner },
    );
    expect(runner.calls.some((c) => c.cmd.includes('curl -fsSL https://example.com/custom.tar.gz'))).toBe(true);
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
      order.findIndex((c) => c.includes('tar xz -C /opt/hola')),
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
    expect(runner.calls.some((c) => c.cmd.includes('install.sh') || c.cmd.includes('tar xz'))).toBe(false);
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
