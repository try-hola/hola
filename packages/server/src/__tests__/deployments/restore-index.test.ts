/**
 * `RestoreIndexStore` (spec 008, data-model.md §3c) — the published snapshot
 * index. Real-filesystem harness (`RealStorageService` over a `mkdtemp`
 * root) because publish/discard/survive-a-restart are exactly the
 * behaviours `MockStorageService` cannot exercise honestly.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RestoreIndexStore } from '../../services/core/restore-index';
import { RealStorageService } from '../../services/core/storage';
import type { RestoreIndexEntry } from '@hola/shared';

const entry = (captureId: string, overrides: Partial<RestoreIndexEntry> = {}): RestoreIndexEntry => ({
  captureId,
  takenAt: '2026-02-01T09:00:00.000Z',
  sizeBytes: 1024,
  location: `/srv/hola/apps/wiki-1a2b3c4d`,
  identity: null,
  ...overrides,
});

describe('RestoreIndexStore (spec 008)', () => {
  let dataRoot: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'hola-restore-index-'));
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  // Quickstart scenario 16
  test('publish REPLACES the provider index wholesale — never merges', async () => {
    const store = new RestoreIndexStore(new RealStorageService({ holaDir: dataRoot }));
    await store.publish('backrest-1', [entry('cap-1'), entry('cap-2')]);
    await store.publish('backrest-1', [entry('cap-3')]);
    const entries = await store.entriesFor('backrest-1');
    expect(entries.map((e) => e.captureId)).toEqual(['cap-3']);
  });

  // Quickstart scenario 18
  test('a published entry round-trips every field, including a present and a null identity', async () => {
    const store = new RestoreIndexStore(new RealStorageService({ holaDir: dataRoot }));
    const withIdentity = entry('cap-with', {
      identity: { app: 'mealie', installName: 'recipes', appVersion: '3.2.0', channel: 'stable', subdomain: 'recipes', host: 'recipes.example.com', writtenAt: '2026-01-01T00:00:00.000Z' },
    });
    const withoutIdentity = entry('cap-without', { identity: null });
    await store.publish('backrest-1', [withIdentity, withoutIdentity]);
    const entries = await store.entriesFor('backrest-1');
    expect(entries).toEqual([withIdentity, withoutIdentity]);
  });

  // Quickstart scenario 19
  test('the index survives a process restart — rebuild the storage service over the same directory', async () => {
    const store1 = new RestoreIndexStore(new RealStorageService({ holaDir: dataRoot }));
    await store1.publish('backrest-1', [entry('cap-1')]);

    const store2 = new RestoreIndexStore(new RealStorageService({ holaDir: dataRoot }));
    const entries = await store2.entriesFor('backrest-1');
    expect(entries.map((e) => e.captureId)).toEqual(['cap-1']);
  });

  test('discard removes exactly the named provider\'s entries; other providers are untouched', async () => {
    const store = new RestoreIndexStore(new RealStorageService({ holaDir: dataRoot }));
    await store.publish('backrest-1', [entry('cap-1')]);
    await store.publish('backrest-2', [entry('cap-2')]);
    await store.discard('backrest-1');
    expect(await store.entriesFor('backrest-1')).toEqual([]);
    expect((await store.entriesFor('backrest-2')).map((e) => e.captureId)).toEqual(['cap-2']);
  });

  test('an unpublished provider reads as an empty entry list, and hasPublished reads false', async () => {
    const store = new RestoreIndexStore(new RealStorageService({ holaDir: dataRoot }));
    expect(await store.entriesFor('nobody')).toEqual([]);
    expect(await store.hasPublished('nobody')).toBe(false);
    await store.publish('nobody', []);
    expect(await store.hasPublished('nobody')).toBe(true);
  });

  test('entryFor resolves a single capture by id, or undefined when the index no longer names it', async () => {
    const store = new RestoreIndexStore(new RealStorageService({ holaDir: dataRoot }));
    await store.publish('backrest-1', [entry('cap-1')]);
    expect((await store.entryFor('backrest-1', 'cap-1'))?.captureId).toBe('cap-1');
    expect(await store.entryFor('backrest-1', 'cap-gone')).toBeUndefined();
  });
});
