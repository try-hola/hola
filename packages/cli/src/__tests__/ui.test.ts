import { describe, it, expect } from 'vitest';

import { formatComposeLine, parseComposePs, renderContainerTable, renderChecks } from '../lib/ui';

// picocolors auto-disables ANSI off a TTY (as under vitest), so the rendered
// strings here are plain text and assert cleanly.

describe('formatComposeLine', () => {
  it('condenses compose resource lines to "<name> <verb>"', () => {
    expect(formatComposeLine(' Container authentik-server  Started')).toBe('authentik-server started');
    expect(formatComposeLine(' Container authentik-server  Starting')).toBe('authentik-server starting');
    expect(formatComposeLine(' Network hola_default  Created')).toBe('hola_default created');
    expect(formatComposeLine(' Volume hola_data  Created')).toBe('hola_data created');
  });

  it('strips our own installer bracket tags', () => {
    expect(formatComposeLine('[install] provisioning Authentik secrets')).toBe('provisioning Authentik secrets');
    expect(formatComposeLine('[compose] Starting production stack')).toBe('Starting production stack');
  });

  it('drops blanks and pure progress noise', () => {
    expect(formatComposeLine('')).toBeNull();
    expect(formatComposeLine('   ')).toBeNull();
    expect(formatComposeLine('[+] Running 7/7')).toBeNull();
  });

  it('passes other lines through trimmed', () => {
    expect(formatComposeLine('  pulling image foo  ')).toBe('pulling image foo');
  });
});

describe('parseComposePs', () => {
  it('parses NDJSON and shows only published host ports', () => {
    const nd = [
      JSON.stringify({ Name: 'traefik', Service: 'traefik', State: 'running', Status: 'Up (healthy)', Publishers: [{ PublishedPort: 443 }, { PublishedPort: 80 }] }),
      JSON.stringify({ Name: 'hola-server', Service: 'server', State: 'running', Status: 'Up', Publishers: [{ PublishedPort: 0, TargetPort: 3001 }] }),
    ].join('\n');
    const rows = parseComposePs(nd);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.name === 'traefik')?.ports).toBe('80, 443'); // deduped + sorted
    expect(rows.find((r) => r.name === 'hola-server')?.ports).toBe('—'); // internal-only
  });

  it('parses the single-array form too', () => {
    const arr = JSON.stringify([{ Name: 'x', Service: 'x', State: 'running', Status: 'Up' }]);
    expect(parseComposePs(arr)).toHaveLength(1);
  });

  it('ignores blank input and non-JSON noise', () => {
    expect(parseComposePs('')).toEqual([]);
    expect(parseComposePs('not json at all\n')).toEqual([]);
  });
});

describe('renderContainerTable', () => {
  it('renders a header and one row per container, sorted by name', () => {
    const out = renderContainerTable([
      { name: 'traefik', service: 'traefik', state: 'running', status: 'Up (healthy)', ports: '80, 443' },
      { name: 'authentik', service: 'authentik', state: 'created', status: 'Up (starting)', ports: '—' },
    ]);
    const lines = out.split('\n');
    expect(lines[0]).toContain('NAME');
    expect(lines[0]).toContain('STATUS');
    expect(lines[0]).toContain('PORTS');
    expect(lines[1]).toContain('authentik'); // sorted before traefik
    expect(lines[2]).toContain('traefik');
  });

  it('returns an empty string when there are no rows', () => {
    expect(renderContainerTable([])).toBe('');
  });
});

describe('renderChecks', () => {
  it('renders one compact block: a heading, a line per check, and a summary', () => {
    const out = renderChecks([
      { name: 'DNS: apps.example.com', status: 'pass' },
      { name: 'AWS credentials', status: 'pass' },
      { name: 'Catalog URL', status: 'warn', detail: 'HTTP 503' },
    ]);
    const lines = out.split('\n');
    // One heading + 3 check rows + 1 summary, with NO blank lines between rows.
    expect(lines).toHaveLength(5);
    expect(lines[0]).toContain('Validation');
    expect(lines[1]).toContain('DNS: apps.example.com');
    expect(lines[3]).toContain('Catalog URL');
    expect(lines[3]).toContain('— HTTP 503'); // detail rendered inline
    expect(lines[4]).toContain('2 passed');
    expect(lines[4]).toContain('1 warning');
  });

  it('pluralizes and surfaces failures in the summary', () => {
    const summary = renderChecks([
      { name: 'a', status: 'pass' },
      { name: 'b', status: 'warn' },
      { name: 'c', status: 'warn' },
      { name: 'd', status: 'fail' },
    ]).split('\n').at(-1)!;
    expect(summary).toContain('1 passed');
    expect(summary).toContain('2 warnings');
    expect(summary).toContain('1 failed');
  });

  it('returns an empty string when there are no checks', () => {
    expect(renderChecks([])).toBe('');
  });
});
