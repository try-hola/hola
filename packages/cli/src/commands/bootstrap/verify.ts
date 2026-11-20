// Post-install verify for `hola bootstrap`. It is warn-only: it never fails the bootstrap.
//
// Two decisions are recorded here because each one was wrong once:
//
// 1. The path is the PUBLIC `/api/system/health`, not `/api/health`. `/api/health`
//    requires a credential, so on a host with auth enabled (the default:
//    `hola init` always sets authentik) the verify got 401 from a perfectly
//    healthy stack and printed "UI not ready yet", every time (#576). Requesting it
//    via HOLA_DOMAIN still exercises the whole front door: Traefik → web nginx → `/api`
//    proxy → server.
//
// 2. A verified request is tried FIRST, and `-k` is only a fallback. Until ACME issues
//    the real certificate, Traefik serves its self-signed default. The two cases call
//    for different messages ("all good" vs "up, but the certificate isn't trusted
//    yet"), so curl's own verdict is kept rather than hidden behind a blanket `-k`.
//    Without the fallback, a reachable stack would look down during that window.

/** The single remote command. It prints `<mode> <http_code>`, with mode `verified` or `insecure`. */
export function buildVerifyCommand(domain: string): string {
  const url = `https://${domain}/api/system/health`;
  // curl reports 000 when it got no HTTP response at all. That covers a TLS
  // verification failure, as well as DNS/connect failures, which the -k retry
  // tells apart.
  return (
    `c=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 ${url} 2>/dev/null || true); ` +
    `if [ "$c" = "000" ] || [ -z "$c" ]; then ` +
    `c=$(curl -sk -o /dev/null -w "%{http_code}" --max-time 15 ${url} 2>/dev/null || true); ` +
    `echo "insecure \${c:-000}"; ` +
    `else echo "verified $c"; fi`
  );
}

export type VerifyOutcome =
  | { kind: 'ok' } // 200 over a trusted certificate
  | { kind: 'untrusted-cert' } // 200, but only with -k: the certificate isn't trusted (yet)
  | { kind: 'not-ready'; code: string }; // anything else (no response, 404, 502, …)

export function interpretVerify(stdout: string): VerifyOutcome {
  const [mode, code = ''] = stdout.trim().split(/\s+/);
  if (code === '200' && mode === 'verified') return { kind: 'ok' };
  if (code === '200' && mode === 'insecure') return { kind: 'untrusted-cert' };
  return { kind: 'not-ready', code: code && code !== '000' ? code : 'no response' };
}

export function verifyMessage(outcome: VerifyOutcome): string {
  switch (outcome.kind) {
    case 'ok':
      return '  UI is responding (200).';
    case 'untrusted-cert':
      return '  UI is responding (200), but its TLS certificate is not trusted yet. ACME issuance can take a minute or two; if it persists, check DNS and the ACME settings.';
    case 'not-ready':
      return `  UI not ready yet (got "${outcome.code}"). It may take a minute for TLS/DNS.`;
  }
}
