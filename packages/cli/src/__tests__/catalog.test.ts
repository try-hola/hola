import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { runCatalog } from '../commands/catalog/catalog';
import type { HolaSdk } from '@hola/sdk';

function makeSdk(items: Array<{ id: string; name: string; description: string; icon: string; channels?: string[] }>) {
  return {
    catalog: {
      apps: vi.fn(async () => ({ items, page: 1, limit: 100, total: items.length })),
      refresh: vi.fn(async () => ({ success: true, sources: [{ id: 'hola', name: 'Hola', ok: true }] })),
    },
  };
}

describe('catalog', () => {
  let logs: string[];
  beforeEach(() => {
    process.exitCode = 0;
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((m?: unknown) => { logs.push(String(m)); });
  });
  afterEach(() => { vi.restoreAllMocks(); process.exitCode = 0; });

  it('lists apps and passes the query through to the catalog endpoint', async () => {
    const sdk = makeSdk([{ id: 'gitea', name: 'Gitea', description: 'Git service', icon: '🍵' }]);
    await runCatalog('git', { category: 'apps' }, { sdk: sdk as unknown as HolaSdk });

    expect(sdk.catalog.apps).toHaveBeenCalledWith({ q: 'git', category: 'apps', page: 1, limit: 100 });
    expect(logs.join('\n')).toContain('gitea');
    expect(logs.join('\n')).toContain('Git service');
  });

  it('emits JSON with --json', async () => {
    const sdk = makeSdk([{ id: 'gitea', name: 'Gitea', description: 'Git service', icon: '🍵' }]);
    await runCatalog(undefined, { json: true }, { sdk: sdk as unknown as HolaSdk });
    const parsed = JSON.parse(logs.join('\n'));
    expect(parsed.items[0].id).toBe('gitea');
  });

  it('handles an empty catalog', async () => {
    const sdk = makeSdk([]);
    await runCatalog(undefined, {}, { sdk: sdk as unknown as HolaSdk });
    expect(logs.join('\n')).toMatch(/No apps found/i);
  });

  // #428
  it('shows a (channels: rc) suffix for an app with a non-stable channel', async () => {
    const sdk = makeSdk([{ id: 'demo', name: 'Demo', description: 'Demo app', icon: '📦', channels: ['stable', 'rc'] }]);
    await runCatalog(undefined, {}, { sdk: sdk as unknown as HolaSdk });
    expect(logs.join('\n')).toContain('(channels: rc)');
  });

  it('shows no channels suffix for an app on stable only', async () => {
    const sdk = makeSdk([{ id: 'demo', name: 'Demo', description: 'Demo app', icon: '📦', channels: ['stable'] }]);
    await runCatalog(undefined, {}, { sdk: sdk as unknown as HolaSdk });
    expect(logs.join('\n')).not.toContain('channels:');
  });
// --- --refresh (#464) -------------------------------------------------------

  it('--refresh re-fetches the sources before listing, and says which', async () => {
    // The server caches its catalog index for 24h, so a version published moments
    // ago is invisible without this — to `catalog` and to `upgrade` alike.
    const sdk = makeSdk([{ id: 'gitea', name: 'Gitea', description: 'Git service', icon: '🍵' }]);
    await runCatalog(undefined, { refresh: true }, { sdk: sdk as unknown as HolaSdk });

    expect(sdk.catalog.refresh).toHaveBeenCalledWith(true);
    expect(logs.join('\n')).toContain('Refreshed hola');
    expect(sdk.catalog.apps).toHaveBeenCalled();
  });

  it('without --refresh it never refreshes', async () => {
    const sdk = makeSdk([{ id: 'gitea', name: 'Gitea', description: 'Git service', icon: '🍵' }]);
    await runCatalog(undefined, {}, { sdk: sdk as unknown as HolaSdk });
    expect(sdk.catalog.refresh).not.toHaveBeenCalled();
  });

  it('a source that fails to refresh is named, and the listing still happens', async () => {
    const sdk = makeSdk([{ id: 'gitea', name: 'Gitea', description: 'Git service', icon: '🍵' }]);
    sdk.catalog.refresh = vi.fn(async () => ({ success: false, sources: [{ id: 'pofallon', name: 'p', ok: false, error: 'HTTP 404' }] }));
    await runCatalog(undefined, { refresh: true }, { sdk: sdk as unknown as HolaSdk });

    expect(logs.join('\n')).toContain('Could not refresh pofallon: HTTP 404');
    expect(sdk.catalog.apps).toHaveBeenCalled();
  });
});
