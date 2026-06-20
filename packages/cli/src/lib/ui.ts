// Terminal presentation helpers for the CLI: colors, a single-line spinner that
// degrades to plain logging off a TTY, and pure formatters for the compose
// stream + container table. The formatters are pure (no clack, no TTY) so they
// unit-test directly; only the spinner touches @clack/prompts, lazily, and only
// when stdout is a TTY. picocolors auto-disables when NO_COLOR is set or stdout
// is not a TTY, so piped/CI output stays plain.

import pc from 'picocolors';

export const colors = pc;

/** Is stdout an interactive terminal? Drives spinner animation and color. */
export function isInteractive(): boolean {
  return Boolean(process.stdout.isTTY);
}

// --- Spinner -----------------------------------------------------------------

export interface Spinner {
  /** Replace the live message (the latest progress line). */
  update(msg: string): void;
  /** Stop with a green check + message. */
  succeed(msg?: string): void;
  /** Stop with a red cross + message. */
  fail(msg?: string): void;
}

/**
 * A single-line progress spinner. On a TTY it animates via @clack/prompts
 * (lazily imported, so tests and non-TTY runs never load clack). Off a TTY it
 * degrades to one start line and one end line — no control codes, no animation.
 */
export function createSpinner(label: string): Spinner {
  if (!isInteractive()) {
    // Non-TTY: announce start, stay quiet during, print the outcome once.
    console.log(label);
    return {
      update() {},
      succeed(msg) { if (msg) console.log(`  ${msg}`); },
      fail(msg) { if (msg) console.error(`  ${msg}`); },
    };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let s: any;
  const ready = import('@clack/prompts').then((clack) => {
    s = clack.spinner();
    s.start(label);
  });
  return {
    update(msg) { void ready.then(() => s?.message(msg)); },
    succeed(msg) { void ready.then(() => s?.stop(msg ?? label, 0)); },
    fail(msg) { void ready.then(() => s?.stop(msg ?? label, 1)); },
  };
}

// --- Compose stream formatting ----------------------------------------------

/**
 * Condense a raw line from `docker compose up` / install.sh into a short status
 * suitable for a spinner's live message, or null to drop it (blank lines and
 * pure progress-bar noise). Examples:
 *   " Container authentik-server  Started"  → "authentik-server started"
 *   "[install] provisioning Authentik …"    → "provisioning Authentik …"
 */
export function formatComposeLine(raw: string): string | null {
  const line = raw.replace(/\r/g, '').trim();
  if (!line) return null;

  // `[+] Running 7/7`, `⠿`, and bare progress glyphs carry no useful detail.
  if (/^\[\+\]/.test(line) || /^[⠿⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏\s]+$/.test(line)) return null;

  // " Container <name>  <Verb>" / " Network <name>  <Verb>" / " Volume …".
  const m = line.match(/^(Container|Network|Volume|Image)\s+(\S+)\s+(.+)$/);
  if (m) {
    const [, , name, verb] = m;
    return `${name} ${verb.toLowerCase()}`;
  }

  // Our own installer chatter: drop the bracket tag, keep the message.
  const tag = line.match(/^\[(install|compose)\]\s+(.*)$/);
  if (tag) return tag[2];

  return line;
}

// --- Container table ---------------------------------------------------------

export interface PsRow {
  name: string;
  service: string;
  state: string;
  status: string;
  ports: string;
}

interface ComposePsJson {
  Name?: string;
  Service?: string;
  State?: string;
  Status?: string;
  Health?: string;
  Publishers?: { URL?: string; PublishedPort?: number; TargetPort?: number; Protocol?: string }[] | null;
}

/**
 * Parse `docker compose ps --format json`. Compose emits either one JSON object
 * per line (NDJSON) or a single JSON array, depending on version — handle both.
 * Only published host ports are shown (internal-only services get "—").
 */
export function parseComposePs(stdout: string): PsRow[] {
  const objs: ComposePsJson[] = [];
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try { objs.push(...(JSON.parse(trimmed) as ComposePsJson[])); } catch { /* fall through */ }
  } else {
    for (const l of trimmed.split('\n')) {
      const s = l.trim();
      if (!s) continue;
      try { objs.push(JSON.parse(s) as ComposePsJson); } catch { /* skip non-JSON noise */ }
    }
  }
  return objs.map((o) => {
    const published = (o.Publishers ?? [])
      .map((p) => p?.PublishedPort)
      .filter((p): p is number => typeof p === 'number' && p > 0);
    const ports = published.length ? Array.from(new Set(published)).sort((a, b) => a - b).join(', ') : '—';
    return {
      name: o.Name ?? o.Service ?? '?',
      service: o.Service ?? '',
      state: (o.State ?? '').toLowerCase(),
      status: o.Status ?? o.State ?? '',
      ports,
    };
  });
}

/** Color a status cell by health: green=healthy/up, yellow=starting, red=exited. */
function colorStatus(row: PsRow): string {
  const s = `${row.state} ${row.status}`.toLowerCase();
  if (/exit|dead|restarting|unhealthy/.test(s)) return colors.red(row.status);
  if (/starting|created|waiting/.test(s)) return colors.yellow(row.status);
  if (/healthy|running|up/.test(s)) return colors.green(row.status);
  return row.status;
}

/**
 * Render a column-aligned container table. Returns the full string (caller
 * prints it) so this stays pure and testable. The NAME column is bold; STATUS
 * is colorized by health. Color codes are length-corrected during alignment.
 */
export function renderContainerTable(rows: PsRow[]): string {
  if (!rows.length) return '';
  const sorted = [...rows].sort((a, b) => a.name.localeCompare(b.name));
  const headers = ['NAME', 'STATUS', 'PORTS'];
  // Visible cells (no color) for width; styled cells for output.
  const plain = sorted.map((r) => [r.name, r.status, r.ports]);
  const styled = sorted.map((r) => [colors.bold(r.name), colorStatus(r), colors.dim(r.ports)]);
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...plain.map((row) => row[i].length)),
  );
  const pad = (text: string, visibleLen: number, width: number) => text + ' '.repeat(Math.max(0, width - visibleLen));
  const headerLine = '  ' + headers.map((h, i) => pad(colors.dim(h), h.length, widths[i])).join('  ');
  const body = sorted.map((_, r) =>
    '  ' + styled[r].map((cell, i) => pad(cell, plain[r][i].length, widths[i])).join('  '),
  );
  return [headerLine, ...body].join('\n');
}
