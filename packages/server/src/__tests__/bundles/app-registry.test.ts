/**
 * App registry feed: pure helpers (ADR 0002).
 */

import { describe, test, expect } from 'bun:test';

import { buildRegistry, coerceConsumes, type RegistryApp } from '../../services/core/app-registry';

describe('buildRegistry', () => {
  const apps: RegistryApp[] = [
    { id: 'vaultwarden-2', app: 'vaultwarden', name: 'Vaultwarden', url: 'https://vw.x', icon: '🔐', status: 'running' },
    { id: 'gitea-1', app: 'gitea', name: 'Gitea', url: 'https://gitea.x', icon: '📦', status: 'stopped' },
  ];

  test('emits a deterministic, name-sorted document', () => {
    const doc = JSON.parse(buildRegistry(apps));
    expect(doc.apps.map((a: RegistryApp) => a.name)).toEqual(['Gitea', 'Vaultwarden']);
    expect(doc.apps[0]).toEqual({
      id: 'gitea-1', app: 'gitea', name: 'Gitea', url: 'https://gitea.x', icon: '📦', status: 'stopped',
    });
  });

  test('byte-identical for the same set regardless of input order', () => {
    expect(buildRegistry(apps)).toBe(buildRegistry([...apps].reverse()));
  });
});

describe('coerceConsumes', () => {
  test('accepts a string, an array, and rejects junk', () => {
    expect(coerceConsumes('app-registry')).toEqual(['app-registry']);
    expect(coerceConsumes([' app-registry ', 'backup'])).toEqual(['app-registry', 'backup']);
    expect(coerceConsumes([])).toBeUndefined();
    expect(coerceConsumes(undefined)).toBeUndefined();
    expect(coerceConsumes(42)).toBeUndefined();
  });
});
