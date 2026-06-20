import { clackPrompter, PromptCancelled, type Prompter } from '../../install/prompter';
import { systemRunner, type Runner } from '../../lib/runner';

export interface TeardownOptions {
  host?: string;
  /** Install directory on the host (default /opt/hola). */
  dir?: string;
  /** Preserve volumes and the data/install directories — only stop + remove containers. */
  keepData?: boolean;
  /** Also remove the ghcr.io/try-hola/* images. */
  images?: boolean;
  /** Skip the confirmation prompt. */
  yes?: boolean;
  /** Print the plan without connecting. */
  dryRun?: boolean;
  json?: boolean;
}

export interface TeardownResult {
  host: string;
  dir: string;
  steps: string[];
}

class TeardownAbort extends Error {}

const DEFAULT_DIR = '/opt/hola';

/**
 * Tear down a Hola deployment on a host over SSH — the inverse of `bootstrap`.
 * By default this is destructive (removes containers, the `hola` network, named
 * volumes, and the data/install directories); `--keep-data` preserves volumes and
 * directories. Returns the result, or undefined on failure/cancel (after setting
 * a non-zero exit code).
 */
export async function runTeardown(
  opts: TeardownOptions,
  injected?: { prompter?: Prompter; runner?: Runner }
): Promise<TeardownResult | undefined> {
  const prompter = injected?.prompter ?? clackPrompter();
  const runner = injected?.runner ?? systemRunner();
  const out = (msg: string) => { if (!opts.json) console.log(msg); };

  const host = opts.host;
  const dir = opts.dir ?? DEFAULT_DIR;
  const vol = opts.keepData ? '' : '-v';

  // The remote steps. Force-removing by name/label keeps this robust even if the
  // compose files are already gone. App deployments are separate `hola-<id>`
  // projects whose containers/volumes also match the `hola` prefix.
  const steps: { title: string; cmd: string }[] = [
    {
      title: 'Stop the platform stack',
      cmd: `[ -d ${dir} ] && (cd ${dir} && docker compose down ${vol} --remove-orphans) 2>/dev/null || true`,
    },
    {
      title: 'Remove remaining Hola containers',
      cmd: `docker ps -a --format '{{.Names}}' | grep -E '^hola-' | xargs -r docker rm -f 2>/dev/null || true`,
    },
    {
      title: 'Remove the hola network',
      cmd: `docker network rm hola 2>/dev/null || true`,
    },
  ];
  if (!opts.keepData) {
    steps.push({
      title: 'Remove Hola volumes',
      cmd: `docker volume ls -q | grep -E '^hola(_|-)' | xargs -r docker volume rm -f 2>/dev/null || true`,
    });
    steps.push({
      title: 'Remove data and install directories',
      // Derive the app data root from the host .env (falls back to the default),
      // and also remove the default /srv/hola parent. App data is written by
      // containers as root, so try sudo -n first.
      cmd:
        `apps=$(grep -E '^HOLA_APPS_BIND_ROOT=' ${dir}/.env 2>/dev/null | cut -d= -f2- | xargs); apps="\${apps:-/srv/hola/apps}"; ` +
        `rm -rf ${dir} 2>/dev/null; ` +
        `sudo -n rm -rf "$apps" /srv/hola 2>/dev/null || rm -rf "$apps" /srv/hola 2>/dev/null || true`,
    });
  }
  if (opts.images) {
    steps.push({
      title: 'Remove Hola images',
      cmd: `docker images --format '{{.Repository}}:{{.Tag}}' | grep -E '^ghcr.io/try-hola/' | xargs -r docker rmi -f 2>/dev/null || true`,
    });
  }

  try {
    if (!host) throw new TeardownAbort('--host user@vm is required.');

    // Plan (always shown — this is destructive).
    out(`Teardown plan for ${host}${opts.keepData ? ' (data kept)' : ''}:`);
    for (const s of steps) out(`  • ${s.title}`);
    if (!opts.keepData) {
      out('\nThis PERMANENTLY DELETES all Hola data on the host: named volumes');
      out(`(incl. the Authentik database), the app data root, and ${dir} (compose, .env, TLS certs).`);
    }

    if (opts.dryRun) {
      out('\nDry run — the remote commands that WOULD run:');
      for (const s of steps) out(`  # ${s.title}\n  ssh ${host} ${s.cmd}`);
      out('\nNo connection was made. Re-run without --dry-run to execute.');
      return { host, dir, steps: steps.map((s) => s.title) };
    }

    // Confirmation. Full teardown requires typing the host (guards against data
    // loss); --keep-data is a simpler yes/no. `--yes` skips either.
    if (!opts.yes) {
      if (opts.keepData) {
        const ok = await prompter.prompt({
          key: '_confirm',
          type: 'confirm',
          message: `Stop Hola on ${host} (containers only; data kept)?`,
          default: 'false',
        });
        if (ok !== 'true') throw new TeardownAbort('Cancelled.');
      } else {
        const typed = await prompter.prompt({
          key: '_confirm',
          type: 'text',
          message: `Type the host (${host}) to confirm permanent deletion`,
          validate: (v: string) => (v.trim() === host ? undefined : `Enter "${host}" to confirm, or Ctrl-C to cancel`),
        });
        if (typed.trim() !== host) throw new TeardownAbort('Cancelled.');
      }
    }

    const ssh = async (title: string, cmd: string) => {
      out(`==> ${title}`);
      const r = await runner.ssh(host, cmd, { stream: (l) => out(`  ${l}`) });
      return r;
    };

    // Connectivity probe — fail fast with a clear message.
    const probe = await runner.ssh(host, 'command -v docker >/dev/null 2>&1 && echo ok || echo nodocker');
    if (probe.code !== 0) throw new TeardownAbort(`Could not connect to ${host} (ssh exit ${probe.code}).`);
    if (!probe.stdout.includes('ok')) out('Note: docker was not found on the host — there may be nothing to remove.');

    for (const s of steps) await ssh(s.title, s.cmd);

    const result: TeardownResult = { host, dir, steps: steps.map((s) => s.title) };
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      out(`\nDone. Hola has been torn down on ${host}${opts.keepData ? ' (data preserved)' : ''}.`);
    }
    return result;
  } catch (err) {
    if (err instanceof TeardownAbort || err instanceof PromptCancelled) {
      console.error(err.message);
      process.exitCode = 1;
      return undefined;
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`teardown failed: ${msg}`);
    if (/ENOENT|spawn ssh/i.test(msg)) console.error('Hint: the `ssh` client must be installed and on PATH.');
    process.exitCode = 1;
    return undefined;
  }
}
