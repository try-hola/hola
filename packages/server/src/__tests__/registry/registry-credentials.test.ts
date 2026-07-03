import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, stat, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { RealStorageService } from '../../services/core/storage';
import { RealRegistryCredentialService } from '../../services/core/registry-credentials';

describe('RealRegistryCredentialService', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  async function makeService() {
    const holaDir = await mkdtemp(join(tmpdir(), 'hola-cred-test-'));
    dirs.push(holaDir);
    const storage = new RealStorageService({ holaDir });
    return { svc: new RealRegistryCredentialService(storage), holaDir };
  }

  test('add persists a 0o600 file, list redacts the token, resolve returns it', async () => {
    const { svc, holaDir } = await makeService();

    const record = await svc.add({ id: 'acme', registry: 'ghcr.io', username: 'bot', password: 'ghp_secret' });
    expect(record).toEqual({ id: 'acme', registry: 'ghcr.io', username: 'bot' });

    // The store file is owner-only and never contains the raw token in plaintext.
    const storePath = join(holaDir, 'config', 'registry-credentials.json');
    const mode = (await stat(storePath)).mode & 0o777;
    expect(mode).toBe(0o600);
    const raw = await readFile(storePath, 'utf8');
    expect(raw).not.toContain('ghp_secret');

    // list() never exposes the secret…
    const listed = await svc.list();
    expect(listed).toEqual([{ id: 'acme', registry: 'ghcr.io', username: 'bot' }]);
    expect(JSON.stringify(listed)).not.toContain('ghp_secret');

    // …but resolve() hands the full credential to the pull path.
    const resolved = await svc.resolve('acme');
    expect(resolved).toEqual({ registry: 'ghcr.io', username: 'bot', password: 'ghp_secret' });
  });

  test('generates an id when omitted and rejects duplicates', async () => {
    const { svc } = await makeService();
    const a = await svc.add({ registry: 'ghcr.io', username: 'bot', password: 'x' });
    expect(a.id).toMatch(/^cred_/);

    await expect(svc.add({ id: a.id, registry: 'ghcr.io', username: 'bot', password: 'y' })).rejects.toThrow('CREDENTIAL_ID_EXISTS');
  });

  test('remove deletes and 404s an unknown id; resolve of unknown is undefined', async () => {
    const { svc } = await makeService();
    await svc.add({ id: 'acme', registry: 'ghcr.io', username: 'bot', password: 'x' });

    await svc.remove('acme');
    expect(await svc.list()).toEqual([]);
    expect(await svc.resolve('acme')).toBeUndefined();
    await expect(svc.remove('acme')).rejects.toThrow('CREDENTIAL_NOT_FOUND');
  });

  test('persists across service instances (rehydrates from disk)', async () => {
    const holaDir = await mkdtemp(join(tmpdir(), 'hola-cred-test-'));
    dirs.push(holaDir);
    const storage = new RealStorageService({ holaDir });

    await new RealRegistryCredentialService(storage).add({ id: 'acme', registry: 'ghcr.io', username: 'bot', password: 'x' });
    const reloaded = await new RealRegistryCredentialService(storage).resolve('acme');
    expect(reloaded?.password).toBe('x');
  });
});
