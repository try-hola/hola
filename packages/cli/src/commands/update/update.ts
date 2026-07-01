import { isNewerVersion } from '@hola/shared';

import { clackPrompter, PromptCancelled, type Prompter } from '../../install/prompter';
import { parseEnv } from '../../install/render-env';
import { systemRunner, type Runner } from '../../lib/runner';
import { createSpinner, formatComposeLine, parseComposePs, renderContainerTable, colors } from '../../lib/ui';
import { CLI_VERSION } from '../../version';
import { selfUpdateCli, type SelfUpdateArgs, type SelfUpdateOutcome } from './self-update';

// Self-update touches the real filesystem/network and re-execs the process, so
// it's suppressed by default under the test runner (the same VITEST guard the SSE
// client uses); unit tests exercise it via `selfUpdateCli` or an injected stub.
const IS_TEST =
  typeof process !== 'undefined' &&
  !!(process.env.VITEST || process.env.VITEST_WORKER_ID || process.env.NODE_ENV === 'test');

export interface UpdateOptions {
  host?: string;
  repo?: string;
  ref?: string;
  /** Override the compose-bundle download URL (defaults to the release asset for this CLI version). */
  tarballUrl?: string;
  dir?: string;
  /** For an explicit HOLA_AUTH_MODE=none host: turn SSO on as part of the upgrade. */
  enableSso?: boolean;
  /** For an explicit HOLA_AUTH_MODE=none host: keep it off (suppress the prompt/warning). */
  keepAuthMode?: boolean;
  /**
   * Take a pre-upgrade local snapshot on the host before re-running install.sh.
   * Default (enabled); set to `false` by `--no-backup` (via mri negation) to skip
   * it. The platform stack has no rollback, so this synchronous local archive of
   * `.env` + `traefik/acme` + the `hola-data` volume is the platform-tier safety net.
   */
  backup?: boolean;
  /** Also include the (potentially large) app-data bind root in the pre-upgrade snapshot. */
  backupAppData?: boolean;
  /** Report versions (CLI / installed / latest release) without changing anything. */
  check?: boolean;
  /**
   * Set to `false` by `--no-self-update` (via mri negation) to skip upgrading the
   * CLI binary and only update the server to this CLI's version. Default (enabled)
   * brings the CLI up to the latest release first, then updates the server to match.
   */
  selfUpdate?: boolean;
  dryRun?: boolean;
  json?: boolean;
}

export interface UpdateResult {
  host: string;
  dir: string;
  ref: string;
  /** The version the host was on before the upgrade (null if it couldn't be read). */
  fromVersion: string | null;
  /** The version the host was upgraded to. */
  toVersion: string;
  /** What was decided about SSO reconciliation (for an explicit `none` host). */
  ssoAction?: 'enabled' | 'kept-none' | 'already-on' | 'backfilled';
  /**
   * Path on the host of the pre-upgrade snapshot archive, or null when no backup
   * was taken (`--no-backup`, `--dry-run`, or `--check`).
   */
  backupPath?: string | null;
  steps: string[];
}

export interface UpdateCheckReport {
  host: string;
  cli: string;
  /** The version installed on the host (from its VERSION file), or null. */
  installed: string | null;
  /** Newest published release, or null if the lookup failed. */
  latest: string | null;
  updateAvailable: boolean;
  /** CLI is newer than the running server — an upgrade would close the skew. */
  skew: boolean;
  releaseUrl: string | null;
}

class UpdateAbort extends Error {}

const DEFAULT_REPO = 'https://github.com/try-hola/hola.git';
const DEFAULT_DIR = '/opt/hola';

const VERSION_MARKER = '__HOLA_VERSION__=';
const EXAMPLE_MARKER = '__HOLA_EXAMPLE__';
const ENV_MARKER = '__HOLA_ENV__';

/** Stdout marker the pre-upgrade backup prints so its archive path can be parsed back out. */
const BACKUP_PATH_MARKER = 'HOLA_BACKUP_PATH=';
/** Default app-data bind root (mirrors the server's DEFAULT_APPS_BIND_ROOT); overridable via HOLA_APPS_BIND_ROOT. */
const DEFAULT_APPS_BIND_ROOT = '/srv/hola/apps';

/** Keys install.sh / compose generate or derive on their own — never "missing" config. */
const AUTO_MANAGED = /^(AUTHENTIK_|COMPOSE_)/;
function isAutoManaged(key: string): boolean {
  return AUTO_MANAGED.test(key) || key === 'HOLA_AUTHENTIK_PUBLIC_URL' || key === 'HOLA_AUTHENTIK_URL';
}

/** Strip a leading `cli-v` from a release tag to get the bare version (cli-v0.3.0 → 0.3.0). */
function versionFromRef(ref: string): string {
  return ref.startsWith('cli-v') ? ref.slice('cli-v'.length) : ref;
}

/** Derive the GitHub release-download base from a clone URL (…/hola.git → …/hola). */
function releaseBase(repo: string): string {
  return repo.replace(/\.git$/, '');
}

/** Derive the GitHub API releases URL from a clone URL (…/owner/repo.git → api.github.com/repos/owner/repo/releases). */
function releasesApiUrl(repo: string): string | null {
  const m = repo.replace(/\.git$/, '').match(/github\.com[/:]([^/]+)\/([^/]+)$/);
  if (!m) return null;
  return `https://api.github.com/repos/${m[1]}/${m[2]}/releases?per_page=30`;
}

interface GitHubRelease {
  tag_name: string;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  body?: string;
}

// Marker the release workflow writes after the auto-generated changelog and before
// the install snippet, so we print only the changelog portion. A release without it
// (older, pre-changelog releases) yields no notes rather than dumping install text.
const CHANGELOG_SENTINEL = '<!-- hola:changelog-end -->';

/** Build the GitHub API URL for a single release by tag, or null for a non-GitHub remote. */
function releaseByTagApiUrl(repo: string, tag: string): string | null {
  const m = repo.replace(/\.git$/, '').match(/github\.com[/:]([^/]+)\/([^/]+)$/);
  if (!m) return null;
  return `https://api.github.com/repos/${m[1]}/${m[2]}/releases/tags/${tag}`;
}

/**
 * Changelog notes for `cli-v<version>` (the portion of the release body before the
 * install-snippet sentinel) plus the release URL, or null on any failure / a
 * release with no changelog. Fail-safe: never blocks or fails the update.
 */
export async function fetchReleaseNotes(
  repo: string,
  version: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ notes: string; url: string } | null> {
  const api = releaseByTagApiUrl(repo, `cli-v${version}`);
  if (!api) return null;
  try {
    const res = await fetchImpl(api, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'hola-cli' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const rel = (await res.json()) as { body?: string; html_url?: string };
    const body = typeof rel.body === 'string' ? rel.body : '';
    if (!body.includes(CHANGELOG_SENTINEL)) return null;
    const notes = body.split(CHANGELOG_SENTINEL)[0].trim();
    if (!notes) return null;
    return { notes, url: typeof rel.html_url === 'string' ? rel.html_url : '' };
  } catch {
    return null;
  }
}

/**
 * Newest stable `cli-v*` release (version + notes URL), or null on any failure.
 * Fail-safe so an offline/rate-limited check never blocks or misreports.
 */
async function fetchLatestRelease(
  repo: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ version: string; url: string } | null> {
  const api = releasesApiUrl(repo);
  if (!api) return null;
  try {
    const res = await fetchImpl(api, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'hola-cli' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const releases = (await res.json()) as GitHubRelease[];
    if (!Array.isArray(releases)) return null;
    let best: { version: string; url: string } | null = null;
    for (const r of releases) {
      if (r.draft || r.prerelease) continue;
      if (typeof r.tag_name !== 'string' || !r.tag_name.startsWith('cli-v')) continue;
      const version = r.tag_name.slice('cli-v'.length);
      if (!best || isNewerVersion(version, best.version)) best = { version, url: r.html_url };
    }
    return best;
  } catch {
    return null;
  }
}

/** Production CLI self-update: real binary path, fetch, spawn, and process exit. */
function realSelfUpdate(args: SelfUpdateArgs): Promise<SelfUpdateOutcome> {
  return selfUpdateCli(args, {
    execPath: process.execPath,
    platform: process.platform,
    arch: process.arch,
    userArgs: process.argv.slice(2),
    baseEnv: process.env,
    fetchImpl: fetch,
    spawn: (cmd, a, env) =>
      import('node:child_process').then(
        ({ spawn }) =>
          new Promise<number>((resolve, reject) => {
            const child = spawn(cmd, a, { stdio: 'inherit', env });
            child.on('error', reject);
            child.on('close', (code) => resolve(code ?? 1));
          }),
      ),
    exit: (code) => process.exit(code),
    out: (msg) => console.log(msg),
  });
}

/**
 * Config-preserving in-place upgrade. First self-updates the CLI to the latest
 * release (unless --no-self-update or a pinned --ref) and re-execs, so the host is
 * then brought up to that same version. Over SSH it preflights the host, reads the
 * current `.env`/VERSION,
 * reconciles the auth mode to the Authentik-default baseline (prompting/flag-gated
 * for an explicit `none`), takes a pre-upgrade local snapshot on the host (unless
 * `--no-backup`), downloads the version-pinned bundle and extracts it over the
 * install dir WITHOUT touching `.env` or the ACME store, re-runs the idempotent
 * installer (which backfills newly-required keys and recreates changed services),
 * and reports old → new. Returns the result, or undefined on failure.
 */
export async function runUpdate(
  opts: UpdateOptions,
  injected?: {
    prompter?: Prompter;
    runner?: Runner;
    /** Injectable release lookup for tests / `--check`. */
    fetchLatest?: (repo: string) => Promise<{ version: string; url: string } | null>;
    /** Injectable changelog lookup for the post-update "what's new" summary (tests). */
    fetchNotes?: (repo: string, version: string) => Promise<{ notes: string; url: string } | null>;
    /** Injectable CLI self-update (tests); defaults to the real fs/network/re-exec impl. */
    selfUpdate?: (args: SelfUpdateArgs) => Promise<SelfUpdateOutcome>;
  },
): Promise<UpdateResult | UpdateCheckReport | undefined> {
  const prompter = injected?.prompter ?? clackPrompter();
  const runner = injected?.runner ?? systemRunner();
  const fetchLatest = injected?.fetchLatest ?? ((repo: string) => fetchLatestRelease(repo));
  const fetchNotes = injected?.fetchNotes ?? ((repo: string, v: string) => fetchReleaseNotes(repo, v));
  const selfUpdate = injected?.selfUpdate ?? realSelfUpdate;
  const out = (msg: string) => { if (!opts.json) console.log(msg); };

  const host = opts.host;
  const repo = opts.repo ?? DEFAULT_REPO;
  const ref = opts.ref ?? `cli-v${CLI_VERSION}`;
  const version = versionFromRef(ref);
  const dir = opts.dir ?? DEFAULT_DIR;
  const composeDir = dir;
  const tarballUrl = opts.tarballUrl ?? `${releaseBase(repo)}/releases/download/${ref}/hola-compose-${version}.tar.gz`;
  const steps: string[] = [];

  try {
    if (!host) throw new UpdateAbort('--host user@vm is required.');
    if (opts.enableSso && opts.keepAuthMode) {
      throw new UpdateAbort('--enable-sso and --keep-auth-mode are mutually exclusive.');
    }

    // Helper: run a remote step (or describe it under --dry-run).
    const ssh = async (title: string, cmd: string, o?: { input?: string; stream?: boolean }) => {
      steps.push(title);
      if (opts.dryRun) {
        out(`# ${title}`);
        out(`  ssh ${host} ${cmd}`);
        return { code: 0, stdout: '', stderr: '' };
      }
      out(colors.dim(`==> ${title}`));
      return runner.ssh(host, cmd, {
        input: o?.input,
        stream: o?.stream ? (l) => out(`  ${l}`) : undefined,
      });
    };

    // --- `--check`: read the installed version + latest release, report, exit. ---
    if (opts.check) {
      const read = await runner.ssh(host, `cat ${composeDir}/VERSION 2>/dev/null | tr -d ' \\t\\r\\n'`);
      if (read.code !== 0) throw new UpdateAbort(`Could not connect to ${host} (ssh exit ${read.code}).`);
      const installed = read.stdout.trim() || null;
      const latest = await fetchLatest(repo);
      const report: UpdateCheckReport = {
        host,
        cli: CLI_VERSION,
        installed,
        latest: latest?.version ?? null,
        updateAvailable: !!(latest && installed && isNewerVersion(latest.version, installed)),
        skew: !!(installed && isNewerVersion(CLI_VERSION, installed)),
        releaseUrl: latest?.url ?? null,
      };
      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        out(`CLI version:       ${colors.bold(report.cli)}`);
        out(`Installed (host):  ${colors.bold(report.installed ?? 'unknown')}`);
        out(`Latest release:    ${colors.bold(report.latest ?? 'unavailable')}`);
        if (report.updateAvailable) {
          out(`\n${colors.yellow('A newer Hola version')} (${colors.bold(report.latest!)}) is available.`);
          const behindLatest = isNewerVersion(report.latest!, CLI_VERSION);
          out(
            `Run ${colors.cyan(`hola update --host ${host}`)} to upgrade` +
              (behindLatest ? ' the CLI and the server.' : ' the server.'),
          );
        } else if (report.skew) {
          out(`\n${colors.yellow('Version skew:')} the server (${report.installed}) is older than your CLI (${report.cli}).`);
          out(`Run ${colors.cyan(`hola update --host ${host}`)} to bring it up to the CLI's version.`);
        } else {
          out(`\n${colors.green('✔')} Up to date.`);
        }
      }
      return report;
    }

    // 0) Self-update the CLI to the latest release, then re-exec so the server
    //    update runs at that version (so `hola update` brings BOTH up to date).
    //    Skipped when the user pinned a version (--ref), opted out
    //    (--no-self-update → selfUpdate === false), or we're already the re-exec'd
    //    child (HOLA_SELF_UPDATED). Suppressed under the test runner unless a stub
    //    is injected, so unit runs never touch the network or replace a binary.
    const selfUpdateActive = !!injected?.selfUpdate || !IS_TEST;
    if (
      selfUpdateActive &&
      opts.selfUpdate !== false &&
      !opts.ref &&
      !process.env.HOLA_SELF_UPDATED
    ) {
      const latest = await fetchLatest(repo);
      if (latest && isNewerVersion(latest.version, CLI_VERSION)) {
        const outcome = await selfUpdate({
          repo,
          latestVersion: latest.version,
          currentVersion: CLI_VERSION,
          dryRun: opts.dryRun,
        });
        // On a successful replace selfUpdate re-execs and never returns; reaching
        // here means it didn't run. Only a non-writable binary is fatal — the user
        // must upgrade the CLI out-of-band (or opt out) to avoid a CLI/server skew.
        if (outcome === 'not-writable') {
          throw new UpdateAbort(
            `A newer Hola CLI (${latest.version}) is available, but this binary can't be replaced:\n` +
              `  ${process.execPath}\n` +
              `Upgrade the CLI, then re-run update:\n` +
              `  curl -fsSL https://raw.githubusercontent.com/try-hola/hola/main/cli-install.sh | sh\n` +
              `Or re-run with write access to that path, or pass --no-self-update to update the ` +
              `server to v${CLI_VERSION} only.`,
          );
        }
      }
    }

    // 1) Preflight (single remote probe → key=value lines). The host pulls
    //    prebuilt images, so it needs docker + compose + curl/tar — but not git.
    const probe =
      'for c in docker curl tar; do command -v "$c" >/dev/null 2>&1 && echo "$c=ok" || echo "$c=missing"; done; ' +
      'docker compose version >/dev/null 2>&1 && echo compose=ok || echo compose=missing; ' +
      'docker ps >/dev/null 2>&1 && echo dockerperm=ok || echo dockerperm=fail';
    if (opts.dryRun) {
      await ssh('Preflight host', probe);
    } else {
      const r = await ssh('Preflight host', probe);
      if (r.code !== 0) throw new UpdateAbort(`Could not connect to ${host} (ssh exit ${r.code}).`);
      const p = parsePreflight(r.stdout);
      assertPreflight(p);
      out('  host OK (docker, compose, curl/tar, permissions)');
    }

    // 2) Read the current install: its .env (for the deployment config + auth mode)
    //    and VERSION (the old version, for the old → new report). One round trip.
    let config: Record<string, string> = {};
    let fromVersion: string | null = null;
    let oldExampleKeys: string[] = [];
    if (opts.dryRun) {
      await ssh('Read current install', readStateCmd(composeDir));
    } else {
      const read = await ssh('Read current install', readStateCmd(composeDir));
      if (read.code !== 0) throw new UpdateAbort(`Could not connect to ${host} (ssh exit ${read.code}).`);
      const parsed = parseState(read.stdout);
      if (!parsed.hasEnv) {
        throw new UpdateAbort(
          `No Hola install found at ${composeDir}/.env on ${host}.\n` +
            `Install first with: hola bootstrap --host ${host}` + (opts.dir ? ` --dir ${opts.dir}` : ''),
        );
      }
      config = parsed.config;
      fromVersion = parsed.version;
      oldExampleKeys = parsed.exampleKeys;
      out(`  found install ${fromVersion ? colors.bold(`v${fromVersion}`) : colors.dim('(version unknown)')} at ${composeDir}`);
    }

    // 2.5) Pre-upgrade snapshot (#284). The platform stack has no rollback — VERSION
    //    is a single marker, with no release history. Before any mutation, archive a
    //    timestamped local snapshot of the platform-tier rollback surface: `.env`,
    //    the `traefik/acme` cert store, and the `hola-data` volume (drafts/deploys/
    //    platform state). Synchronous, on-host, no external dependency (NOT Backrest,
    //    which is operator-configured/optional/async). App-data binds are large and
    //    opt-in (`--backup-app-data`). `--no-backup` skips it. A failure here is
    //    fail-closed: we don't upgrade a stack we couldn't snapshot.
    let backupPath: string | null = null;
    if (opts.backup !== false) {
      const appDataRoot = (config.HOLA_APPS_BIND_ROOT?.trim() || DEFAULT_APPS_BIND_ROOT).replace(/\/+$/, '');
      const res = await ssh(
        'Snapshot current install (.env, traefik/acme, hola-data)',
        backupCmd(composeDir, fromVersion, { appData: !!opts.backupAppData, appDataRoot }),
        { stream: true },
      );
      if (!opts.dryRun) {
        if (res.code !== 0) {
          throw new UpdateAbort(
            `Pre-upgrade snapshot failed (exit ${res.code}). The platform has no rollback, so the ` +
              `upgrade is halted. Fix the host (disk space / docker access) and retry, or re-run with ` +
              `--no-backup to upgrade without a snapshot.`,
          );
        }
        backupPath = parseBackupPath(res.stdout);
        if (backupPath) out(`  ${colors.dim(`snapshot saved to ${backupPath}`)}`);
      }
    }

    // 3) Reconcile auth mode to the Authentik-default baseline (issue #149). An
    //    unset/blank mode is backfilled automatically by install.sh (no-op here);
    //    an EXPLICIT `none` is surfaced and gated on a choice (flag or prompt).
    let ssoAction: UpdateResult['ssoAction'];
    const rawMode = (config.HOLA_AUTH_MODE ?? '').trim();
    if (rawMode === 'authentik') {
      ssoAction = 'already-on';
    } else if (rawMode === '' ) {
      // install.sh defaults blank → authentik and generates the secrets idempotently.
      if (!opts.dryRun) {
        ssoAction = 'backfilled';
        out(`  ${colors.dim('SSO not set — install.sh will enable Authentik (the default) and generate secrets.')}`);
      }
    } else if (rawMode === 'none') {
      const decision = await decideSso(opts, prompter);
      if (decision === 'enable') {
        const authDomain =
          config.HOLA_AUTHENTIK_DOMAIN?.trim() ||
          (config.HOLA_BASE_DOMAIN?.trim() ? `auth.${config.HOLA_BASE_DOMAIN.trim()}` : '');
        if (!authDomain) {
          throw new UpdateAbort(
            'Cannot enable SSO: no HOLA_AUTHENTIK_DOMAIN and no HOLA_BASE_DOMAIN to derive it from.',
          );
        }
        // Flip the mode + domain in the host .env BEFORE install.sh runs, so it
        // generates the Authentik secrets and activates the profile this pass.
        const setEnv = await ssh(
          'Enable SSO (set auth mode + Authentik domain)',
          envSetCmd(composeDir, [['HOLA_AUTH_MODE', 'authentik'], ['HOLA_AUTHENTIK_DOMAIN', authDomain]]),
        );
        if (!opts.dryRun && setEnv.code !== 0) throw new UpdateAbort(`Updating ${composeDir}/.env failed (exit ${setEnv.code}).`);
        ssoAction = 'enabled';
        out(`  ${colors.yellow('Enabling Authentik SSO')} (login at https://${authDomain}; pulls in ~2 GB of services).`);
      } else {
        ssoAction = 'kept-none';
        out(`  ${colors.dim('Keeping HOLA_AUTH_MODE=none. SSO is now the standard — re-run with --enable-sso to turn it on.')}`);
      }
    }

    // 4) Download + extract the version-pinned bundle over the install dir. The
    //    tarball carries scripts/compose/.env.example/VERSION but NOT .env or
    //    traefik/acme — extracting over the dir preserves the operator's config
    //    and the ACME cert store. The dir already exists (we just read its .env).
    const fetchStack = `set -e; curl -fsSL ${tarballUrl} | tar xz -C ${dir}`;
    const fetchRes = await ssh(`Download Hola ${version} stack into ${composeDir}`, fetchStack, { stream: true });
    if (!opts.dryRun && fetchRes.code !== 0) {
      throw new UpdateAbort(
        `Downloading the compose bundle failed (exit ${fetchRes.code}). ` +
          `Check that release ${ref} exists and the host can reach ${tarballUrl}.`,
      );
    }

    // 5) Config drift: surface keys this RELEASE newly introduced (new bundle's
    //    .env.example minus the old one) that have no safe default and aren't on
    //    the host — i.e. a genuinely new *required* setting install.sh can't fill.
    //    Auto-managed keys (AUTHENTIK_*/COMPOSE_*, generated by install.sh) and
    //    keys that ship a default value in the example are intentionally excluded.
    if (!opts.dryRun) {
      const ex = await ssh('Check config drift (.env.example vs .env)', `cat ${composeDir}/.env.example 2>/dev/null`);
      const concerning = newRequiredKeys(ex.stdout, oldExampleKeys, config);
      if (concerning.length) {
        out(`  ${colors.yellow('New required config')} in this release with no default and not in your .env: ${concerning.join(', ')}`);
        out(`  ${colors.dim('Set these after the upgrade if the affected service misbehaves.')}`);
      }
    }

    // 6) Re-run the idempotent installer: it backfills newly-required keys, pulls
    //    the new pinned images, and recreates only the changed services. State in
    //    the hola-data volume is preserved. HOLA_BOOTSTRAP=1 silences its hints.
    steps.push('Run install.sh');
    const installCmd = `cd ${composeDir} && HOLA_BOOTSTRAP=1 ./scripts/install.sh`;
    if (opts.dryRun) {
      out('# Run install.sh');
      out(`  ssh ${host} ${installCmd}`);
    } else {
      const spin = opts.json ? null : createSpinner('Upgrading — pulling images, recreating services…');
      const installRes = await runner.ssh(host, installCmd, {
        stream: spin ? (l) => { const f = formatComposeLine(l); if (f) spin.update(f); } : undefined,
      });
      if (installRes.code !== 0) {
        spin?.fail('Upgrade failed.');
        throw new UpdateAbort(`install.sh failed (exit ${installRes.code}).`);
      }
      spin?.succeed(colors.green('Stack is up.'));

      if (!opts.json) {
        const ps = await runner.ssh(host, `cd ${composeDir} && docker compose ps --format json 2>/dev/null`);
        const table = renderContainerTable(parseComposePs(ps.stdout));
        if (table) out(`\n${table}\n`);
      }
    }

    const result: UpdateResult = { host, dir, ref, fromVersion, toVersion: version, ssoAction, backupPath, steps };
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else if (opts.dryRun) {
      out('\nDry run — no connection was made. Re-run without --dry-run to execute.');
    } else {
      const span = fromVersion && fromVersion !== version ? `${colors.bold(`v${fromVersion}`)} → ${colors.bold(`v${version}`)}` : colors.bold(`v${version}`);
      out(`\n${colors.green('✔ Done.')} ${colors.bold(host)} is now on ${span}.`);
      if (backupPath) out(`  ${colors.dim(`Pre-upgrade snapshot: ${backupPath}`)}`);
      if (ssoAction === 'enabled') out(`  SSO provisioning runs on first boot; retrieve sign-in with ${colors.cyan(`hola credentials --host ${host}`)}.`);

      // Close with the changelog for the version just installed. Fail-safe: any
      // lookup error (offline, rate-limited, older release with no changelog) is
      // swallowed so it never turns a successful upgrade into a noisy tail.
      const notes = await fetchNotes(repo, version);
      if (notes) {
        out(`\n${colors.bold(`What's new in v${version}`)}`);
        for (const line of notes.notes.split('\n')) out(`  ${line}`);
        if (notes.url) out(`  ${colors.dim(`Full notes: ${notes.url}`)}`);
      }
    }
    return result;
  } catch (err) {
    if (err instanceof UpdateAbort || err instanceof PromptCancelled) {
      console.error(err.message);
      process.exitCode = 1;
      return undefined;
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`update failed: ${msg}`);
    if (/ENOENT|spawn ssh/i.test(msg)) console.error('Hint: the `ssh` client must be installed and on PATH.');
    process.exitCode = 1;
    return undefined;
  }
}

/** Decide SSO handling for an explicit `none` host: flags win; else prompt; else (scripted) require a flag. */
async function decideSso(opts: UpdateOptions, prompter: Prompter): Promise<'enable' | 'keep'> {
  if (opts.enableSso) return 'enable';
  if (opts.keepAuthMode) return 'keep';
  // Non-interactive (scripted) runs must choose explicitly — never silently flip a
  // ~2 GB stack on, nor silently leave a host off the new standard.
  if (opts.json) {
    throw new UpdateAbort(
      'This host has HOLA_AUTH_MODE=none. SSO (Authentik) is now the standard.\n' +
        'Re-run with --enable-sso to turn it on, or --keep-auth-mode to keep it off.',
    );
  }
  const ans = await prompter.prompt({
    key: '_enable_sso',
    type: 'confirm',
    message: 'SSO (Authentik) is now standard but this host has it off. Enable it now? (~2 GB of services)',
    default: 'false',
  });
  return ans === 'true' ? 'enable' : 'keep';
}

/**
 * Remote command for the pre-upgrade snapshot: tar `.env`, the `traefik/acme` cert
 * store, and the `hola-data` volume (captured via `docker cp` from the running
 * `hola-server` — no extra image pull) into a single timestamped archive under
 * `<dir>/backups/`, optionally including the app-data bind root. Prints the archive
 * path behind BACKUP_PATH_MARKER. The `hola-data` capture is best-effort (warns if
 * the server container isn't running) so operator config is still snapshotted; the
 * large app-data tree is added straight from its path (no double-copy).
 */
function backupCmd(
  dir: string,
  fromVersion: string | null,
  opts: { appData: boolean; appDataRoot: string },
): string {
  const safeFrom = (fromVersion ?? 'unknown').replace(/[^A-Za-z0-9._-]/g, '_');
  const lines = [
    'set -e',
    `ts=$(date -u +%Y%m%dT%H%M%SZ)`,
    `bdir="${dir}/backups"`,
    `mkdir -p "$bdir"`,
    `stage=$(mktemp -d)`,
    `trap 'rm -rf "$stage"' EXIT`,
    `if [ -f "${dir}/.env" ]; then cp -p "${dir}/.env" "$stage/.env"; fi`,
    `if [ -d "${dir}/traefik/acme" ]; then cp -a "${dir}/traefik/acme" "$stage/acme"; fi`,
    `if docker cp hola-server:/data "$stage/hola-data" >/dev/null 2>&1; then :; else echo "WARN: hola-data volume not captured (is hola-server running?)" >&2; fi`,
    `archive="$bdir/pre-update-${safeFrom}-$ts.tar.gz"`,
  ];
  if (opts.appData) {
    const root = opts.appDataRoot.replace(/\/+$/, '');
    const parent = root.replace(/\/[^/]+$/, '') || '/';
    const base = root.slice(root.lastIndexOf('/') + 1);
    // App data is tarred straight from its path (no staging copy of a large tree).
    lines.push(
      `if [ -d "${root}" ]; then tar czf "$archive" -C "$stage" . -C "${parent}" "${base}"; else tar czf "$archive" -C "$stage" .; fi`,
    );
  } else {
    lines.push(`tar czf "$archive" -C "$stage" .`);
  }
  lines.push(`echo "${BACKUP_PATH_MARKER}$archive"`);
  return lines.join('; ');
}

/** Pull the archive path back out of the backup command's stdout (last marker line wins). */
function parseBackupPath(stdout: string): string | null {
  let path: string | null = null;
  for (const line of stdout.split('\n')) {
    const t = line.trim();
    if (t.startsWith(BACKUP_PATH_MARKER)) path = t.slice(BACKUP_PATH_MARKER.length).trim() || null;
  }
  return path;
}

/** Remote command that prints the install's VERSION, old .env.example, and .env behind markers, in one read. */
function readStateCmd(dir: string): string {
  return (
    `printf '%s' '${VERSION_MARKER}'; cat ${dir}/VERSION 2>/dev/null | tr -d ' \\t\\r\\n'; ` +
    `printf '\\n%s\\n' '${EXAMPLE_MARKER}'; cat ${dir}/.env.example 2>/dev/null; ` +
    `printf '\\n%s\\n' '${ENV_MARKER}'; cat ${dir}/.env 2>/dev/null`
  );
}

/** Parse readStateCmd output into the version, the pre-upgrade .env.example keys, and the parsed .env. */
function parseState(
  stdout: string,
): { version: string | null; config: Record<string, string>; exampleKeys: string[]; hasEnv: boolean } {
  const exIdx = stdout.indexOf(`\n${EXAMPLE_MARKER}\n`);
  const envIdx = stdout.indexOf(`\n${ENV_MARKER}\n`);
  let version: string | null = null;
  let exampleText = '';
  let envText = stdout;
  if (exIdx >= 0 && envIdx > exIdx) {
    const vLine = stdout.slice(0, exIdx).split('\n').find((l) => l.startsWith(VERSION_MARKER));
    version = (vLine ? vLine.slice(VERSION_MARKER.length).trim() : '') || null;
    exampleText = stdout.slice(exIdx + EXAMPLE_MARKER.length + 2, envIdx);
    envText = stdout.slice(envIdx + ENV_MARKER.length + 2);
  } else if (envIdx >= 0) {
    // Older host with no .env.example to compare against — still recover the env.
    envText = stdout.slice(envIdx + ENV_MARKER.length + 2);
  }
  const config = parseEnv(envText);
  return { version, config, exampleKeys: Object.keys(parseEnv(exampleText)), hasEnv: Object.keys(config).length > 0 };
}

/** Idempotent remote env_set (mirrors install.sh): replace/append each KEY=VALUE in .env. */
function envSetCmd(dir: string, pairs: [string, string][]): string {
  const fn =
    `cd ${dir} && set -e; ` +
    `_set() { tmp=$(mktemp); grep -vE "^$1=" .env > "$tmp" 2>/dev/null || true; printf '%s=%s\\n' "$1" "$2" >> "$tmp"; mv "$tmp" .env; }; `;
  const calls = pairs.map(([k, v]) => `_set ${k} ${v}`).join('; ');
  return fn + calls;
}

/**
 * Keys this release newly introduced (in the new .env.example but not the old one)
 * that have NO default value in the example, aren't auto-generated by install.sh,
 * and aren't already on the host — i.e. a genuinely new required setting the
 * operator must supply. Empty on a same-version re-run.
 */
function newRequiredKeys(newExample: string, oldExampleKeys: string[], config: Record<string, string>): string[] {
  const old = new Set(oldExampleKeys);
  const newMap = parseEnv(newExample);
  return Object.keys(newMap).filter(
    (k) => !old.has(k) && newMap[k] === '' && !(k in config) && !isAutoManaged(k),
  );
}

function parsePreflight(stdout: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of stdout.split('\n')) {
    const t = line.trim();
    const eq = t.indexOf('=');
    if (eq > 0) out[t.slice(0, eq)] = t.slice(eq + 1);
  }
  return out;
}

function assertPreflight(p: Record<string, string>): void {
  if (p.docker !== 'ok' || p.compose !== 'ok') {
    throw new UpdateAbort(
      'Docker + the Compose v2 plugin are required on the host. Install with:\n' +
        '  curl -fsSL https://get.docker.com | sh\n' +
        'then re-run update.',
    );
  }
  if (p.dockerperm !== 'ok') {
    throw new UpdateAbort(
      "This SSH user can't run docker. Add them to the docker group:\n" +
        '  sudo usermod -aG docker $USER   (then reconnect)\n' +
        'then re-run update.',
    );
  }
  if (p.curl !== 'ok' || p.tar !== 'ok') {
    throw new UpdateAbort(
      'curl and tar are required on the host to download the compose bundle ' +
        '(e.g. `sudo apt-get install -y curl tar`), then re-run update.',
    );
  }
}
