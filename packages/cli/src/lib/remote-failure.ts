// Message for a remote step that exited non-zero, shared by every command that
// runs something over SSH (#599, #604).
//
// ssh itself exits 255 on a connection or authentication failure; any other code is
// the REMOTE command's own, so reporting "could not connect" for it blames the
// network for a command failure. Only the stderr tail is quoted: stdout can carry a
// host's `.env`, which must never reach an error message.

import { shq } from './shell-quote';

export function remoteFailureMessage(
  host: string,
  step: string,
  r: { code: number; stderr?: string; signal?: string | null },
): string {
  const err = (r.stderr ?? '').split('\n').map((l) => l.trim()).filter(Boolean).slice(-3).join(' | ');
  const tail = err ? `: ${err}` : '';
  if (r.signal) return `Lost the SSH connection to ${host} during "${step}" (killed by ${r.signal}).`;
  if (r.code === 255) return `Could not connect to ${host} (ssh exit 255)${tail}`;
  return `"${step}" failed on ${host} (exit ${r.code})${tail}`;
}

/** The fix for a root-owned install dir. The CLI never runs sudo; it only prints this. */
export function chownGuidance(user: string, group: string, dir: string): string {
  return (
    `This usually means something once ran as root in that directory. The CLI never runs sudo; fix ownership on the host, then re-run:\n` +
    `  sudo chown -R ${user}:${group} ${shq(dir)}`
  );
}
