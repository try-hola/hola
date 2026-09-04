import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { runDeploymentsList } from '../commands/deployments/deployments';
import type { HolaSdk } from '@hola/sdk';

type Row = { id: string; name: string; app: string; icon: string; status: string; ports: string[]; lastUpdated: string; channel?: string };

function makeSdk(items: Row[]) {
  return {
    deployments: {
      list: vi.fn(async () => ({ items, page: 1, limit: 100, total: items.length })),
    },
  };
}

describe('deployments list (#428)', () => {
  let logs: string[];
  beforeEach(() => {
    process.exitCode = 0;
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((m?: unknown) => { logs.push(String(m)); });
  });
  afterEach(() => { vi.restoreAllMocks(); process.exitCode = 0; });

  it('renders a [<channel>] suffix for a non-stable row', async () => {
    const sdk = makeSdk([
      { id: 'gitea-rc', name: 'gitea-rc', app: 'gitea', icon: '🍵', status: 'running', ports: [], lastUpdated: 'now', channel: 'rc' },
    ]);
    await runDeploymentsList({}, { sdk: sdk as unknown as HolaSdk });
    expect(logs.join('\n')).toContain('gitea-rc [rc]');
  });

  it('renders no suffix for a stable row', async () => {
    const sdk = makeSdk([
      { id: 'gitea', name: 'gitea', app: 'gitea', icon: '🍵', status: 'running', ports: [], lastUpdated: 'now', channel: 'stable' },
    ]);
    await runDeploymentsList({}, { sdk: sdk as unknown as HolaSdk });
    const line = logs.find(l => l.includes('gitea'));
    expect(line).toBeDefined();
    expect(line).not.toContain('[stable]');
  });

  it('renders no suffix when channel is absent (pre-feature record, reads as stable)', async () => {
    const sdk = makeSdk([
      { id: 'gitea', name: 'gitea', app: 'gitea', icon: '🍵', status: 'running', ports: [], lastUpdated: 'now' },
    ]);
    await runDeploymentsList({}, { sdk: sdk as unknown as HolaSdk });
    const line = logs.find(l => l.includes('gitea'));
    expect(line).not.toContain('[');
  });
});
