import { HolaSdk } from '@hola/sdk';
import type { RegistryCredentialRecord } from '@hola/shared';

export interface RegistryCredOptions {
  id?: string;
  registry?: string;
  username?: string;
  token?: string;
  json?: boolean;
}

/**
 * Manage stored registry credentials for private OCI pulls (`add | list | rm`).
 * The token is write-only: it is sent on `add` and never printed back by `list`.
 * These credentials are used for both the `oras pull` of a package and the Docker
 * image pull at deploy time; reference one by id with `install … --registry-cred`.
 */
export async function runRegistryCred(
  action: string,
  opts: RegistryCredOptions,
  injected?: { sdk?: HolaSdk; args?: string[] }
): Promise<void> {
  const sdk = injected?.sdk ?? new HolaSdk();
  const positional = injected?.args ?? [];

  try {
    switch (action) {
      case 'add': {
        if (!opts.registry || !opts.username || !opts.token) {
          console.error('registry-cred add requires --registry, --username and --token');
          process.exitCode = 1;
          return;
        }
        const record = await sdk.registryCredentials.add({
          registry: opts.registry,
          username: opts.username,
          password: opts.token,
          id: opts.id,
        });
        if (opts.json) console.log(JSON.stringify(record, null, 2));
        else console.log(`Added registry credential '${record.id}' for ${record.registry} (user ${record.username}).`);
        return;
      }
      case 'list': {
        const { items } = await sdk.registryCredentials.list();
        if (opts.json) { console.log(JSON.stringify(items, null, 2)); return; }
        if (!items.length) { console.log('No registry credentials stored.'); return; }
        const idWidth = Math.max(2, ...items.map((c: RegistryCredentialRecord) => c.id.length));
        for (const c of items) console.log(`${c.id.padEnd(idWidth)}  ${c.registry}  (${c.username})`);
        return;
      }
      case 'rm':
      case 'remove': {
        const id = opts.id ?? positional[0];
        if (!id) { console.error('registry-cred rm requires a credential id'); process.exitCode = 1; return; }
        await sdk.registryCredentials.remove(id);
        console.log(`Removed registry credential '${id}'.`);
        return;
      }
      default:
        console.error(`Unknown action '${action}'. Use: add | list | rm`);
        process.exitCode = 1;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`registry-cred ${action} failed: ${msg}`);
    process.exitCode = 1;
  }
}
