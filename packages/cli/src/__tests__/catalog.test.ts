import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { runCatalog } from '../commands/catalog/catalog';
import type { HolaSdk } from '@hola/sdk';

function makeSdk(items: Array<{ id: string; name: string; description: string; icon: string }>) {
  return {
    catalog: {
      apps: vi.fn(async () => ({ items, page: 1, limit: 100, total: items.length })),
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
});
