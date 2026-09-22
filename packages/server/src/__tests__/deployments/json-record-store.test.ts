/**
 * `JsonRecordStore` (#497) — the persistence mechanism both brokered-contract
 * state stores share.
 *
 * Its two policies are load-bearing and now live in exactly one place, so they
 * are asserted here directly rather than left implied by the two stores that
 * compose it. Both are deliberate choices about what must NOT happen:
 *
 *  - a missing or corrupt record must not wedge the broker, and
 *  - a failed write must not fail the operation a provider is mid-way through
 *    announcing.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { JsonRecordStore } from '../../services/core/json-record-store';
import { RealStorageService } from '../../services/core/storage';
import type { StorageService } from '../../services/core/storage';

type Rec = { a?: number; b?: string };
const PATH = 'config/test-record.json';

describe('JsonRecordStore (#497)', () => {
  let dataRoot: string;
  let storage: RealStorageService;
  let store: JsonRecordStore<Rec>;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'hola-jsonrec-'));
    storage = new RealStorageService({ holaDir: dataRoot });
    store = new JsonRecordStore<Rec>(storage, {
      path: PATH,
      label: 'test record',
      service: 'TestRecord',
    });
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  test('round-trips a record', async () => {
    await store.write({ a: 1, b: 'two' });
    expect(await store.read()).toEqual({ a: 1, b: 'two' });
  });

  test('a missing record reads as empty — the first-run case, not an error', async () => {
    expect(await store.read()).toEqual({});
  });

  test('a CORRUPT record reads as empty rather than throwing', async () => {
    // The broker must not be wedged by a truncated or hand-edited file. Each
    // caller's own expiry rule decides what empty means — `isPrepareExpired`
    // treats an unparseable timestamp as expired precisely so that failing
    // open here cannot leave a dump on disk forever.
    await mkdir(join(dataRoot, 'config'), { recursive: true });
    await writeFile(join(dataRoot, PATH), '{ this is not json');
    expect(await store.read()).toEqual({});
  });

  test('a write failure is swallowed, not thrown', async () => {
    // Losing the record costs bookkeeping; throwing would fail the operation
    // the provider is mid-way through announcing.
    const failing = {
      fileExists: async () => false,
      readFileAsString: async () => '{}',
      writeFile: async () => {
        throw new Error('disk full');
      },
    } as unknown as StorageService;
    const brittle = new JsonRecordStore<Rec>(failing, {
      path: PATH,
      label: 'test record',
      service: 'TestRecord',
    });
    await expect(brittle.write({ a: 1 })).resolves.toBeUndefined();
  });

  test('a read failure is swallowed too, and yields empty', async () => {
    const failing = {
      fileExists: async () => true,
      readFileAsString: async () => {
        throw new Error('EIO');
      },
      writeFile: async () => {},
    } as unknown as StorageService;
    const brittle = new JsonRecordStore<Rec>(failing, {
      path: PATH,
      label: 'test record',
      service: 'TestRecord',
    });
    expect(await brittle.read()).toEqual({});
  });
});
