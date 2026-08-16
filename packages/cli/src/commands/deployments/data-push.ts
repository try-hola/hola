import os from 'node:os';
import path from 'node:path';
import { stat } from 'node:fs/promises';

import { HolaSdk } from '@hola/sdk';
import type {
  GetDeploymentPushTargetsResponse,
  PostDeploymentActionResponse,
  PostDeploymentPushHookResponse,
} from '@hola/shared';

import { watchJob, reportDeployError } from '../../lib/deploy-flow';
import { clackPrompter, PromptCancelled, type Prompter } from '../../install/prompter';
import { systemRunner, type Runner } from '../../lib/runner';

type PushTarget = GetDeploymentPushTargetsResponse['targets'][number];

export interface DataPushOptions {
  /** List the declared targets and exit (also the behaviour when no target is named). */
  list?: boolean;
  /** `user@host` of the Hola server — where the bytes go. */
  host?: string;
  /** Print the plan (including the exact commands) without connecting. */
  dryRun?: boolean;
  /** Skip the confirmation prompt a `mirror` target otherwise requires. */
  yes?: boolean;
  json?: boolean;
}

export interface DataPushResult {
  deploymentId: string;
  targetId: string;
  destPath: string;
  mode: string;
  quiesced: boolean;
  hookRan: boolean;
}

class PushAbort extends Error {}

/** Per-run OpenSSH control-socket path for connection multiplexing (#181). */
function sshControlPath(): string {
  return path.join(os.tmpdir(), `hola-push-${process.pid}-${Date.now().toString(36)}.sock`);
}

/**
 * OpenSSH connection-sharing args, as `bootstrap` uses: one authenticated master
 * connection is reused by the ownership probe, the rsync transport and the chown,
 * so a password-authenticated host prompts once rather than three times.
 * `ControlMaster=auto` degrades to independent connections rather than failing.
 */
function sshMultiplexArgs(controlPath: string): string[] {
  return ['-o', 'ControlMaster=auto', '-o', `ControlPath=${controlPath}`, '-o', 'ControlPersist=60'];
}

/** Single-quote a value for a remote POSIX shell. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function renderTargets(targets: PushTarget[]): string[] {
  return targets.map((t) => {
    const bits = [`${t.mode}`];
    if (t.quiesce === 'stop') bits.push('app stopped during push');
    if (t.hasPostHook) bits.push('runs a post-push hook');
    const head = `  ${t.id}  ${t.label}  (${bits.join(', ')})`;
    return t.description ? `${head}\n      ${t.description}` : head;
  });
}

/**
 * Push a local directory into one of an app's manifest-declared push targets
 * (#409) — the supported way to bulk-load data (an ebook library, a media tree,
 * a document archive) that's too big or too structured for the app's own upload.
 *
 * Division of labour: the **server** owns everything that needs to know Hola's
 * layout — it resolves the target to an absolute `destPath` and proves it sits
 * inside the deployment's data root, drives stop/start through the normal job
 * lifecycle, and runs any declared postHook in the app's own containers. The
 * **CLI** only moves bytes, over the same SSH transport `bootstrap` uses. That's
 * why `destPath` is used verbatim: the client never joins host paths itself.
 *
 * rsync (not an archive upload) is the point — a re-push after editing a few
 * files locally transfers only the delta.
 *
 * Returns the result, or undefined on failure (after setting a non-zero exit code).
 */
export async function runAppDataPush(
  deploymentId: string,
  target: string | undefined,
  localPath: string | undefined,
  opts: DataPushOptions,
  injected?: { sdk?: HolaSdk; runner?: Runner; prompter?: Prompter }
): Promise<DataPushResult | undefined> {
  const sdk = injected?.sdk ?? new HolaSdk();
  const prompter = injected?.prompter ?? clackPrompter();
  const out = (msg: string) => { if (!opts.json) console.log(msg); };

  const controlPath = sshControlPath();
  const runner = injected?.runner ?? systemRunner(sshMultiplexArgs(controlPath));
  const muxArgs = sshMultiplexArgs(controlPath);

  let quiesced = false;
  let host: string | undefined;

  try {
    const { targets } = (await sdk.deployments.pushTargets(deploymentId)) as GetDeploymentPushTargetsResponse;

    // No target named ⇒ list. Same output as `--list`, so the discovery path is
    // what you get for free when you forget the argument.
    if (opts.list || !target) {
      if (opts.json) {
        console.log(JSON.stringify({ targets }, null, 2));
      } else if (targets.length === 0) {
        out(`${deploymentId} declares no push targets.`);
      } else {
        out(`Push targets for ${deploymentId}:`);
        for (const line of renderTargets(targets)) out(line);
        out(`\nPush with: hola app data push ${deploymentId} <target> <local-path> --host user@server`);
      }
      return undefined;
    }

    const chosen = targets.find((t) => t.id === target);
    if (!chosen) {
      const known = targets.length ? targets.map((t) => t.id).join(', ') : '(none declared)';
      throw new PushAbort(`Unknown push target '${target}' for ${deploymentId}. Declared targets: ${known}`);
    }

    if (!localPath) throw new PushAbort('A local path to push is required.');
    const resolvedLocal = path.resolve(localPath);
    const info = await stat(resolvedLocal).catch(() => undefined);
    if (!info?.isDirectory()) throw new PushAbort(`Local path is not a directory: ${resolvedLocal}`);

    host = opts.host;
    if (!host) throw new PushAbort('--host user@server is required (where the Hola server runs).');

    // Trailing slashes on BOTH sides: copy the *contents* of the local directory
    // into the target directory, rather than nesting it one level deeper.
    const src = `${resolvedLocal.replace(/\/+$/, '')}/`;
    const dest = `${host}:${chosen.destPath.replace(/\/+$/, '')}/`;
    const rsyncArgs = [
      '-az',
      // Protect the remote path from the remote shell's own globbing/splitting.
      '-s',
      '--info=stats2',
      ...(chosen.mode === 'mirror' ? ['--delete'] : []),
      // App data is written by containers as root, so the receiving rsync needs
      // to be too. `-n` fails immediately rather than hanging on a password
      // prompt when passwordless sudo isn't configured.
      '--rsync-path=sudo -n rsync',
      '-e',
      `ssh ${muxArgs.join(' ')} -o ConnectTimeout=10`,
      src,
      dest,
    ];

    const statCmd = `sudo -n stat -c '%u:%g' ${shellQuote(chosen.destPath)}`;

    out(`Push ${src} → ${host}:${chosen.destPath}`);
    out(`  target: ${chosen.id} (${chosen.label})`);
    out(`  mode:   ${chosen.mode}${chosen.mode === 'mirror' ? ' — files on the server that are not in your local copy will be DELETED' : ''}`);
    if (chosen.quiesce === 'stop') out('  the app will be stopped for the duration and started again afterwards');
    if (chosen.hasPostHook) out('  a post-push hook declared by the app will run on the server');

    if (opts.dryRun) {
      out('\nDry run — the commands that WOULD run:');
      out(`  # read the target directory's ownership\n  ssh ${muxArgs.join(' ')} ${host} ${statCmd}`);
      if (chosen.quiesce === 'stop') out(`  # stop ${deploymentId} (via the Hola API)`);
      out(`  # transfer\n  rsync ${rsyncArgs.join(' ')}`);
      out(`  # restore ownership\n  ssh ${muxArgs.join(' ')} ${host} sudo -n chown -R <uid>:<gid> ${shellQuote(chosen.destPath)}`);
      if (chosen.hasPostHook) out(`  # run the app's post-push hook (via the Hola API)`);
      if (chosen.quiesce === 'stop') out(`  # start ${deploymentId} (via the Hola API)`);
      out('\nNo connection was made. Re-run without --dry-run to execute.');
      return { deploymentId, targetId: chosen.id, destPath: chosen.destPath, mode: chosen.mode, quiesced: false, hookRan: false };
    }

    // A mirror push deletes; make the operator say so, as `teardown` does.
    if (chosen.mode === 'mirror' && !opts.yes) {
      const ok = await prompter.prompt({
        key: '_confirm',
        type: 'confirm',
        message: `Mirror into ${chosen.destPath} on ${host}? Server files not present locally will be deleted.`,
        default: 'false',
      });
      if (ok !== 'true') throw new PushAbort('Cancelled.');
    }

    // Read the ownership BEFORE moving anything: the app runs as its own uid/gid
    // (PUID/PGID for LinuxServer images) and files would otherwise arrive owned
    // by the SSH user. The server created this directory, so whatever owns it now
    // is by definition correct — no manifest field needed. A missing directory is
    // a hard error rather than a mkdir: it means the app isn't materialized yet,
    // and creating it here would guess the ownership we're trying to read.
    const probe = await runner.ssh(host, statCmd);
    const ownership = probe.stdout.trim();
    if (probe.code !== 0 || !/^\d+:\d+$/.test(ownership)) {
      throw new PushAbort(
        `Could not read ${chosen.destPath} on ${host}: ${(probe.stderr || probe.stdout).trim() || `ssh exit ${probe.code}`}\n` +
          'The directory must exist (install the app first), and the SSH user needs passwordless sudo (`sudo -n`).'
      );
    }

    if (chosen.quiesce === 'stop') {
      out(`Stopping ${deploymentId}…`);
      const res = (await sdk.deployments.action(deploymentId, { action: 'stop' })) as PostDeploymentActionResponse;
      quiesced = true;
      if (res.jobId) await watchJob(sdk, res.jobId, (m) => out(`  ${m}`));
    }

    out('Transferring…');
    const rsync = await runner.local('rsync', rsyncArgs, { stream: (l) => out(`  ${l}`) });
    if (rsync.code !== 0) {
      throw new PushAbort(`rsync failed (exit ${rsync.code}): ${(rsync.stderr || rsync.stdout).trim()}`);
    }

    const chown = await runner.ssh(host, `sudo -n chown -R ${ownership} ${shellQuote(chosen.destPath)}`);
    if (chown.code !== 0) {
      throw new PushAbort(`Could not restore ownership to ${ownership}: ${(chown.stderr || chown.stdout).trim()}`);
    }

    // The bytes are already on disk, so a hook failure is reported, not fatal:
    // the operator needs to know the reindex/reconnect didn't happen, but there
    // is nothing to roll back — and the app still has to be started again.
    let hookRan = false;
    if (chosen.hasPostHook) {
      out('Running the app\'s post-push hook…');
      const hook = (await sdk.deployments.pushHook(deploymentId, { targetId: chosen.id })) as PostDeploymentPushHookResponse;
      hookRan = true;
      if (!hook.ok) {
        console.error(`Post-push hook failed${hook.output ? `: ${hook.output}` : '.'}`);
        process.exitCode = 1;
      }
    }

    const result: DataPushResult = {
      deploymentId,
      targetId: chosen.id,
      destPath: chosen.destPath,
      mode: chosen.mode,
      quiesced,
      hookRan,
    };
    if (opts.json) console.log(JSON.stringify(result, null, 2));
    else out(`\nDone. ${chosen.label} pushed to ${deploymentId}.`);
    return result;
  } catch (err) {
    if (err instanceof PushAbort || err instanceof PromptCancelled) {
      console.error(err.message);
      process.exitCode = 1;
      return undefined;
    }
    return reportDeployError(err);
  } finally {
    // Always try to bring the app back up if we stopped it — a failed transfer
    // must not leave the app down.
    if (quiesced && host) {
      try {
        console.log(`Starting ${deploymentId}…`);
        const res = (await sdk.deployments.action(deploymentId, { action: 'start' })) as PostDeploymentActionResponse;
        if (res.jobId) await watchJob(sdk, res.jobId, (m) => console.log(`  ${m}`));
      } catch (startErr) {
        const msg = startErr instanceof Error ? startErr.message : String(startErr);
        console.error(`Could not start ${deploymentId} again: ${msg}`);
        console.error(`Start it manually with: hola restart ${deploymentId}`);
        process.exitCode = 1;
      }
    }
    // Tear down the shared master connection so no control socket lingers (#181).
    if (host && !opts.dryRun) {
      try {
        await runner.local('ssh', ['-O', 'exit', '-o', `ControlPath=${controlPath}`, host]);
      } catch {
        // ignore — a persist-expiring socket is harmless
      }
    }
  }
}
