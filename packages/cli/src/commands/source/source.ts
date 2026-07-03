import { HolaSdk } from '@hola/sdk';
import type { CatalogSourceRecord } from '@hola/shared';

export interface SourceOptions {
  id?: string;
  name?: string;
  url?: string;
  /** `--registry` + `--cred` register auth for a private source. */
  registry?: string;
  cred?: string;
  json?: boolean;
}

/**
 * Manage catalog sources (`add | list | rm`) — the Homebrew-tap model. A source
 * is a catalog.json (same schema as the public catalog) hosted elsewhere,
 * optionally with a stored registry credential for private packages. The built-in
 * `hola` source is always present and can't be removed.
 */
export async function runSource(
  action: string,
  opts: SourceOptions,
  injected?: { sdk?: HolaSdk; args?: string[] }
): Promise<void> {
  const sdk = injected?.sdk ?? new HolaSdk();
  const positional = injected?.args ?? [];

  try {
    switch (action) {
      case 'add': {
        const id = opts.id ?? positional[0];
        if (!id || !opts.url) {
          console.error('source add requires an id and --url (and optionally --name, --registry + --cred)');
          process.exitCode = 1;
          return;
        }
        if ((opts.registry && !opts.cred) || (!opts.registry && opts.cred)) {
          console.error('source add: --registry and --cred must be provided together');
          process.exitCode = 1;
          return;
        }
        const auth = opts.registry && opts.cred ? { registry: opts.registry, credentialRef: opts.cred } : undefined;
        const record = await sdk.catalogSources.add({ id, name: opts.name ?? id, url: opts.url, auth });
        if (opts.json) console.log(JSON.stringify(record, null, 2));
        else console.log(`Added catalog source '${record.id}' → ${record.url}${auth ? ` (auth: ${auth.credentialRef})` : ''}.`);
        return;
      }
      case 'list': {
        const { items } = await sdk.catalogSources.list();
        if (opts.json) { console.log(JSON.stringify(items, null, 2)); return; }
        const idWidth = Math.max(2, ...items.map((s: CatalogSourceRecord) => s.id.length));
        for (const s of items) {
          const flags = [s.trust, s.enabled ? 'enabled' : 'disabled'].join(', ');
          console.log(`${s.id.padEnd(idWidth)}  ${s.url || '(no url)'}  [${flags}]`);
        }
        return;
      }
      case 'rm':
      case 'remove': {
        const id = opts.id ?? positional[0];
        if (!id) { console.error('source rm requires a source id'); process.exitCode = 1; return; }
        await sdk.catalogSources.remove(id);
        console.log(`Removed catalog source '${id}'.`);
        return;
      }
      default:
        console.error(`Unknown action '${action}'. Use: add | list | rm`);
        process.exitCode = 1;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`source ${action} failed: ${msg}`);
    process.exitCode = 1;
  }
}
