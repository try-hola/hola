/**
 * `RestoreBrokerStateStore` (spec 008, data-model.md §4) — the request
 * queue's persisted store. Real-filesystem harness for the same reason
 * `restore-index.test.ts` uses one: survival across a rebuilt storage
 * service is the actual behaviour under test.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  RestoreBrokerStateStore,
  isRestoreRequestExpired,
  pruneTerminalRequests,
  restoreRequestTimeoutMs,
  DEFAULT_RESTORE_REQUEST_TIMEOUT_MS,
  TERMINAL_RECORD_RETENTION_MS,
  type RestoreRequestRecord,
  type RestoreRequestStore,
} from '../../services/core/restore-broker-state';
import { RealStorageService } from '../../services/core/storage';

const record = (overrides: Partial<RestoreRequestRecord> = {}): RestoreRequestRecord => ({
  id: 'req-1',
  providerDeploymentId: 'backrest-1',
  targetDeploymentId: 'mealie-2',
  targetAppId: 'mealie',
  captureId: 'cap-1',
  destination: '/srv/hola/restore/req-1',
  status: 'pending',
  createdAt: '2026-02-01T09:00:00.000Z',
  // Far enough in the future not to have already expired relative to real
  // wall-clock test-run time (individual tests override for expiry cases).
  deadlineAt: '2099-01-01T00:00:00.000Z',
  ...overrides,
});

describe('restoreRequestTimeoutMs (spec 008, scenario 27)', () => {
  const prev = process.env.HOLA_RESTORE_REQUEST_TIMEOUT_MS;
  afterEach(() => {
    if (prev === undefined) delete process.env.HOLA_RESTORE_REQUEST_TIMEOUT_MS;
    else process.env.HOLA_RESTORE_REQUEST_TIMEOUT_MS = prev;
  });

  test('defaults to 30 minutes', () => {
    delete process.env.HOLA_RESTORE_REQUEST_TIMEOUT_MS;
    expect(restoreRequestTimeoutMs()).toBe(DEFAULT_RESTORE_REQUEST_TIMEOUT_MS);
    expect(DEFAULT_RESTORE_REQUEST_TIMEOUT_MS).toBe(30 * 60 * 1000);
  });

  test('HOLA_RESTORE_REQUEST_TIMEOUT_MS overrides it; an invalid value falls back to the default', () => {
    process.env.HOLA_RESTORE_REQUEST_TIMEOUT_MS = '5000';
    expect(restoreRequestTimeoutMs()).toBe(5000);
    process.env.HOLA_RESTORE_REQUEST_TIMEOUT_MS = 'not-a-number';
    expect(restoreRequestTimeoutMs()).toBe(DEFAULT_RESTORE_REQUEST_TIMEOUT_MS);
  });
});

describe('isRestoreRequestExpired (spec 008, R11 — fail-closed on an unparseable timestamp)', () => {
  const soonDeadline = '2026-02-01T09:30:00.000Z';

  test('a pending/claimed record past its deadline is expired', () => {
    const now = Date.parse('2026-02-01T10:00:00.000Z');
    expect(isRestoreRequestExpired(record({ status: 'pending', deadlineAt: soonDeadline }), now)).toBe(true);
    expect(isRestoreRequestExpired(record({ status: 'claimed', deadlineAt: soonDeadline }), now)).toBe(true);
  });

  test('a record before its deadline is not expired', () => {
    const now = Date.parse('2026-02-01T09:10:00.000Z');
    expect(isRestoreRequestExpired(record({ status: 'pending', deadlineAt: soonDeadline }), now)).toBe(false);
  });

  test('a terminal record (completed/failed/expired) is never re-evaluated as freshly expired', () => {
    const now = Date.parse('2026-02-01T10:00:00.000Z');
    expect(isRestoreRequestExpired(record({ status: 'completed', deadlineAt: soonDeadline }), now)).toBe(false);
    expect(isRestoreRequestExpired(record({ status: 'failed', deadlineAt: soonDeadline }), now)).toBe(false);
  });

  test('an unparseable deadline reads as expired (fail-closed, mirrors isPrepareExpired)', () => {
    const now = Date.parse('2026-02-01T09:10:00.000Z');
    expect(isRestoreRequestExpired(record({ status: 'pending', deadlineAt: 'not-a-date' }), now)).toBe(true);
  });
});

describe('pruneTerminalRequests (#502 — the store must not grow without bound)', () => {
  const NOW = Date.parse('2026-03-01T12:00:00.000Z');
  const ago = (ms: number) => new Date(NOW - ms).toISOString();
  const DAY = 24 * 60 * 60 * 1000;

  /** The newest terminal record is always kept as the activity anchor, so every
   *  fixture below carries one that is NOT the record under test. */
  const anchor = record({ id: 'anchor', status: 'completed', completedAt: ago(60_000) });
  const build = (...records: RestoreRequestRecord[]): RestoreRequestStore =>
    Object.fromEntries(records.map((r) => [r.id, r]));

  test('a terminal record past the retention window is pruned', () => {
    const store = build(
      anchor,
      record({ id: 'done', status: 'completed', completedAt: ago(3 * DAY) }),
      record({ id: 'failed', status: 'failed', completedAt: ago(2 * DAY), failureReason: 'repository unreachable' }),
      // An expiry is recorded by flipping the status alone, so its terminal
      // moment is the deadline it blew, not a `completedAt`.
      record({ id: 'expired', status: 'expired', deadlineAt: ago(2 * DAY) }),
    );
    const result = pruneTerminalRequests(store, { now: NOW });
    expect(result.pruned.sort()).toEqual(['done', 'expired', 'failed']);
    expect(Object.keys(result.store)).toEqual(['anchor']);
  });

  test('a terminal record within the retention window is kept', () => {
    const store = build(
      anchor,
      record({ id: 'done', status: 'completed', completedAt: ago(TERMINAL_RECORD_RETENTION_MS - 60_000) }),
    );
    const result = pruneTerminalRequests(store, { now: NOW });
    expect(result.pruned).toEqual([]);
    expect(Object.keys(result.store).sort()).toEqual(['anchor', 'done']);
  });

  test('a non-terminal record is never pruned, however old', () => {
    const store = build(
      anchor,
      // Both are long past any deadline; only the expiry path may close them,
      // and until it does the install waiting on one still needs it there.
      record({ id: 'pending', status: 'pending', createdAt: ago(30 * DAY), deadlineAt: ago(30 * DAY) }),
      record({ id: 'claimed', status: 'claimed', createdAt: ago(30 * DAY), deadlineAt: ago(30 * DAY), claimedAt: ago(30 * DAY) }),
    );
    const result = pruneTerminalRequests(store, { now: NOW });
    expect(result.pruned).toEqual([]);
    expect(Object.keys(result.store).sort()).toEqual(['anchor', 'claimed', 'pending']);
  });

  test('a retained record is never pruned, however old or terminal', () => {
    const store = build(
      anchor,
      record({ id: 'waited-on', status: 'completed', completedAt: ago(30 * DAY) }),
      record({ id: 'nobody-waiting', status: 'completed', completedAt: ago(30 * DAY) }),
    );
    const result = pruneTerminalRequests(store, { now: NOW, retain: new Set(['waited-on']) });
    expect(result.pruned).toEqual(['nobody-waiting']);
    expect(Object.keys(result.store).sort()).toEqual(['anchor', 'waited-on']);
  });

  test('the newest terminal record survives at any age — it is all `brokerActivity` has to report the last restore from', () => {
    const store = build(
      record({ id: 'newest', status: 'expired', deadlineAt: ago(90 * DAY) }),
      record({ id: 'older', status: 'completed', completedAt: ago(120 * DAY) }),
    );
    const result = pruneTerminalRequests(store, { now: NOW });
    expect(result.pruned).toEqual(['older']);
    expect(Object.keys(result.store)).toEqual(['newest']);
  });

  test('a store with nothing to prune is returned unchanged, so no write is provoked', () => {
    const store = build(anchor, record({ id: 'pending', status: 'pending' }));
    const result = pruneTerminalRequests(store, { now: NOW });
    expect(result.store).toBe(store);
  });
});

describe('RestoreBrokerStateStore (spec 008)', () => {
  let dataRoot: string;
  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'hola-restore-broker-'));
  });
  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  test('get() re-evaluates expiry on read and writes back the expired status (no timer required)', async () => {
    const store = new RestoreBrokerStateStore(new RealStorageService({ holaDir: dataRoot }));
    const past = record({ deadlineAt: new Date(Date.now() - 1000).toISOString() });
    await store.update((s) => ({ ...s, [past.id]: past }));

    const read = await store.get(past.id);
    expect(read?.status).toBe('expired');

    // Persisted, not just returned — a second read agrees.
    const readAgain = await store.get(past.id);
    expect(readAgain?.status).toBe('expired');
  });

  // Quickstart scenario 26 (store half): survives a rebuilt storage service.
  test('the request queue survives a process restart — rebuild the store over the same directory', async () => {
    const store1 = new RestoreBrokerStateStore(new RealStorageService({ holaDir: dataRoot }));
    await store1.update((s) => ({ ...s, [record().id]: record() }));

    const store2 = new RestoreBrokerStateStore(new RealStorageService({ holaDir: dataRoot }));
    const read = await store2.get('req-1');
    expect(read?.status).toBe('pending');
  });

  test('pendingFor returns only pending requests for the named provider, expiring stale ones along the way', async () => {
    const store = new RestoreBrokerStateStore(new RealStorageService({ holaDir: dataRoot }));
    const forA = record({ id: 'a', providerDeploymentId: 'backrest-1', status: 'pending' });
    const forB = record({ id: 'b', providerDeploymentId: 'backrest-2', status: 'pending' });
    const stale = record({ id: 'c', providerDeploymentId: 'backrest-1', status: 'pending', deadlineAt: new Date(Date.now() - 1000).toISOString() });
    await store.update((s) => ({ ...s, a: forA, b: forB, c: stale }));

    const pending = await store.pendingFor('backrest-1');
    expect(pending.map((r) => r.id)).toEqual(['a']);

    // The stale one was expired as a side effect.
    expect((await store.get('c'))?.status).toBe('expired');
  });

  test('a missing/corrupt store file reads as empty rather than throwing', async () => {
    const store = new RestoreBrokerStateStore(new RealStorageService({ holaDir: dataRoot }));
    expect(await store.get('nope')).toBeUndefined();
    expect(await store.pendingFor('nobody')).toEqual([]);
  });

  // FR-028, US3 scenario 2. The store is a read-modify-write over one JSON
  // file and every mutator yields at both of its awaits, so without
  // serialisation two interleaved claims each read `pending`, each write
  // `claimed`, and each conclude they won — the second write clobbering the
  // first. `transition` is the compare-and-set that closes the window, and
  // this is the only test that actually interleaves.
  test('transition is atomic: N concurrent claims of one request produce exactly ONE winner', async () => {
    const store = new RestoreBrokerStateStore(new RealStorageService({ holaDir: dataRoot }));
    await store.update((s) => ({ ...s, 'req-1': record() }));

    const claim = () =>
      store.transition(
        'req-1',
        (r) => r.status === 'pending',
        (r) => ({ ...r, status: 'claimed', claimedAt: new Date().toISOString() }),
      );

    const results = await Promise.all([claim(), claim(), claim(), claim(), claim(), claim(), claim(), claim()]);
    expect(results.filter((r) => r.applied)).toHaveLength(1);
    expect(results.filter((r) => !r.applied)).toHaveLength(7);
    expect((await store.get('req-1'))?.status).toBe('claimed');
  });

  test('transition reports applied: false for a request that does not exist at all', async () => {
    const store = new RestoreBrokerStateStore(new RealStorageService({ holaDir: dataRoot }));
    const result = await store.transition('nope', () => true, (r) => r);
    expect(result).toEqual({ applied: false });
  });

  // FR-035: concurrent requests must not disturb one another. Interleaved
  // writes to DIFFERENT keys must all survive — serialising the store must
  // not turn "last writer wins" into a different lost-update bug.
  test('concurrent updates to different requests all persist', async () => {
    const store = new RestoreBrokerStateStore(new RealStorageService({ holaDir: dataRoot }));
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    await Promise.all(
      ids.map((id) => store.update((s) => ({ ...s, [id]: record({ id, destination: `/srv/hola/restore/${id}` }) }))),
    );
    for (const id of ids) {
      const read = await store.get(id);
      expect(read?.destination).toBe(`/srv/hola/restore/${id}`);
    }
  });

  // #502, the case that matters most: the deploy job polls `get(requestId)`
  // and reads `undefined` as "the provider never answered". Pruning a record
  // the job is still waiting on would fail a restore that actually succeeded.
  test('a record a deploy job is still waiting on is never pruned out from under it', async () => {
    const store = new RestoreBrokerStateStore(new RealStorageService({ holaDir: dataRoot }));
    const stale = new Date(Date.now() - TERMINAL_RECORD_RETENTION_MS - 60_000).toISOString();
    const waited = record({ id: 'waited', status: 'completed', completedAt: stale });
    const newer = record({ id: 'newer', status: 'completed', completedAt: new Date().toISOString() });

    // Pinned BEFORE the record exists, exactly as the job does — otherwise the
    // very write that creates it is also the write that collects it.
    const release = store.retainWhileWaiting('waited');
    await store.update((s) => ({ ...s, waited, newer }));
    expect((await store.get('waited'))?.status).toBe('completed');

    // A provider poll tick prunes too, and it runs every couple of seconds
    // while the job waits — this is the window the pin exists to cover.
    await store.pendingFor('backrest-1');
    expect((await store.get('waited'))?.status).toBe('completed');

    // Released once the job has read its outcome: now it may be collected.
    release();
    await store.pendingFor('backrest-1');
    expect(await store.get('waited')).toBeUndefined();
    expect((await store.get('newer'))?.status).toBe('completed');
  });

  test('creating a request collects the terminal records earlier ones left behind', async () => {
    const store = new RestoreBrokerStateStore(new RealStorageService({ holaDir: dataRoot }));
    const stale = (n: number) => new Date(Date.now() - TERMINAL_RECORD_RETENTION_MS - n * 60_000).toISOString();
    const old: RestoreRequestStore = {};
    for (let i = 0; i < 20; i++) {
      old[`done-${i}`] = record({ id: `done-${i}`, status: 'completed', completedAt: stale(i + 1) });
    }
    // Seeded through `write` so the accumulation this reproduces is the one a
    // pre-#502 host already has on disk, not one `update` would have collected.
    await store.write(old);

    await store.update((s) => ({ ...s, 'req-new': record({ id: 'req-new' }) }));

    // The newest terminal record is kept as the activity anchor; everything
    // else terminal and past retention is gone, alongside the live request.
    const remaining = await store.read();
    expect(Object.keys(remaining).sort()).toEqual(['done-0', 'req-new']);
  });

  // A rejecting operation must not wedge the chain for everything after it.
  test('a throwing operation does not poison the serialised queue', async () => {
    const store = new RestoreBrokerStateStore(new RealStorageService({ holaDir: dataRoot }));
    const boom = store.update(() => {
      throw new Error('boom');
    });
    await expect(boom).rejects.toThrow('boom');
    await store.update((s) => ({ ...s, 'req-1': record() }));
    expect((await store.get('req-1'))?.status).toBe('pending');
  });
});
