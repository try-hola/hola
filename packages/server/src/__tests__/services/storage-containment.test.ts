/**
 * Storage path-containment tests — relative paths must stay inside the hola data
 * root, so an untrusted path component (e.g. an uploaded file name) can't write
 * outside it via '..'. Absolute paths are deliberate (apps bind root) and pass.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RealStorageService } from '../../services/core/storage';

describe('RealStorageService path containment', () => {
  let dataRoot: string;
  let storage: RealStorageService;

  beforeEach(async () => {
    dataRoot = mkdtempSync(join(tmpdir(), 'hola-storage-'));
    storage = new RealStorageService({ holaDir: dataRoot });
    await storage.initialize();
  });

  afterEach(() => {
    rmSync(dataRoot, { recursive: true, force: true });
  });

  it('writes a normal relative path under the data root', async () => {
    await storage.writeFile('drafts/d1/files/abc-config.yml', Buffer.from('ok'));
    expect(existsSync(join(dataRoot, 'drafts/d1/files/abc-config.yml'))).toBe(true);
  });

  it('rejects a relative path that climbs out of the data root', async () => {
    await expect(
      storage.writeFile('drafts/d1/files/abc-../../../../../../tmp/evil', Buffer.from('x')),
    ).rejects.toThrow(/escapes the storage root/);
  });
});
