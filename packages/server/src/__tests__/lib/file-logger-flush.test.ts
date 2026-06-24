/**
 * File-logger flush tests — concurrent flushes (the 5s timer + synchronous
 * error-level logging) must be serialized and append, so no buffered entry is
 * lost to an interleaved read-modify-write.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { RealFileLogger } from '../../lib/file-logger';
import { MockStorageService } from '../../services/core/storage';

describe('RealFileLogger.flush', () => {
  let storage: MockStorageService;

  beforeEach(async () => {
    storage = new MockStorageService();
    await storage.initialize();
  });

  it('serializes concurrent flushes and appends without losing entries', async () => {
    // Capture every append so we can assert each entry lands exactly once.
    const appended: string[] = [];
    const origAppend = storage.appendFile.bind(storage);
    storage.appendFile = async (p, c) => {
      appended.push(c.toString());
      return origAppend(p, c);
    };

    const logger = new RealFileLogger(storage, { flushInterval: 10 * 60 * 1000 });
    await logger.initialize();

    // info() only buffers (no auto-flush); seed several entries.
    await logger.info('entry-alpha');
    await logger.info('entry-bravo');
    await logger.info('entry-charlie');

    // Fire several flushes concurrently — the old read-modify-write could drop
    // already-drained entries; serialization + append must preserve all of them.
    await Promise.all([logger.flush(), logger.flush(), logger.flush()]);

    const all = appended.join('');
    for (const msg of ['entry-alpha', 'entry-bravo', 'entry-charlie']) {
      const occurrences = all.split(`"message":"${msg}"`).length - 1;
      expect(occurrences).toBe(1);
    }
  });
});
