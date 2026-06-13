import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { getHolaDataDir } from '../../config/paths';
import { RealStorageService } from '../../services/core/storage';

describe('Hola data paths', () => {
  const testDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(testDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  test('uses HOLA_DATA_DIR when configured', () => {
    const dataDir = getHolaDataDir({
      HOLA_DATA_DIR: './test-data/hola',
      HOME: '/ignored-home',
    });

    expect(dataDir).toBe(resolve('./test-data/hola'));
  });

  test('falls back to the user home directory', () => {
    const dataDir = getHolaDataDir({ HOME: '/tmp/hola-home' });

    expect(dataDir).toBe('/tmp/hola-home/.hola');
  });

  test('storage resolves all paths below the configured data root', () => {
    const storage = new RealStorageService({ holaDir: '/tmp/hola-test-data' });

    expect(storage.resolveHolaPath('cache', 'bundles')).toBe('/tmp/hola-test-data/cache/bundles');
    expect(storage.resolveTempPath('upload.tmp')).toBe('/tmp/hola-test-data/temp/upload.tmp');
  });

  test('storage roots relative file operations below the configured data root', async () => {
    const holaDir = await mkdtemp(join(tmpdir(), 'hola-storage-test-'));
    testDirectories.push(holaDir);
    const storage = new RealStorageService({ holaDir });

    await storage.writeFile('drafts/example/config.json', '{"name":"example"}');

    expect(await readFile(join(holaDir, 'drafts/example/config.json'), 'utf8')).toBe(
      '{"name":"example"}',
    );
    expect(await storage.readFileAsString('drafts/example/config.json')).toBe('{"name":"example"}');
  });
});
