import { HolaSdk } from '@hola/sdk';
import type { CatalogSourceRecord, UpdateCatalogSourceRequest } from '@hola/shared';

export interface SourceOptions {
  id?: string;
  name?: string;
  url?: string;
  /** `--registry` + `--cred` register auth for a private source. */
  registry?: string;
  cred?: string;
  /**
   * `--allow-registry <glob>` (repeatable, comma-separated) declares the
   * operator's consent to pull this source's bundles from a registry namespace
   * without registering a credential — useful for *public* packages in a
   * first-party registry (e.g. `ghcr.io/myorg/*`). Adds to the server's
   * baseline `HOLA_REGISTRY_ALLOWLIST`.
   */
  allowRegistry?: string[] | string;
  /** `update` only: empty the allowlist (omitting `--allow-registry` leaves it). */
  clearAllowRegistry?: boolean;
  /** `update` only: toggle whether the source's apps are aggregated. */
  enable?: boolean;
  disable?: boolean;
  json?: boolean;
}

/**
 * Flatten `--allow-registry` into a clean glob list. mri may pass repeated flags
 * as an array, or comma-separated inside a single flag.
 */
function parseAllowRegistries(input: string[] | string | undefined): string[] {
  return (Array.isArray(input) ? input : input ? [input] : [])
    .flatMap((s) => s.split(','))
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Manage catalog sources (`add | list | update | rm`) — the Homebrew-tap model. A
 * source is a catalog.json (same schema as the public catalog) hosted elsewhere,
 * optionally with a stored registry credential for private packages. The built-in
 * `hola` source is always present and can't be removed or patched.
 *
 * `update` exists chiefly so `allowRegistries` can be fixed after a
 * `REF_NOT_ALLOWED` pull without deleting and re-adding the source.
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
          console.error('source add requires an id and --url (and optionally --name, --registry + --cred, --allow-registry)');
          process.exitCode = 1;
          return;
        }
        if ((opts.registry && !opts.cred) || (!opts.registry && opts.cred)) {
          console.error('source add: --registry and --cred must be provided together');
          process.exitCode = 1;
          return;
        }
        const auth = opts.registry && opts.cred ? { registry: opts.registry, credentialRef: opts.cred } : undefined;
        const allowRegistries = parseAllowRegistries(opts.allowRegistry);
        const record = await sdk.catalogSources.add({ id, name: opts.name ?? id, url: opts.url, auth, allowRegistries: allowRegistries.length > 0 ? allowRegistries : undefined });
        if (opts.json) console.log(JSON.stringify(record, null, 2));
        else {
          const tail = [
            auth ? `auth: ${auth.credentialRef}` : '',
            allowRegistries.length > 0 ? `allow: ${allowRegistries.join(', ')}` : '',
          ].filter(Boolean).join(' · ');
          console.log(`Added catalog source '${record.id}' → ${record.url}${tail ? ` (${tail})` : ''}.`);
        }
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
      case 'update': {
        const id = opts.id ?? positional[0];
        if (!id) { console.error('source update requires a source id'); process.exitCode = 1; return; }
        if ((opts.registry && !opts.cred) || (!opts.registry && opts.cred)) {
          console.error('source update: --registry and --cred must be provided together');
          process.exitCode = 1;
          return;
        }
        if (opts.enable && opts.disable) {
          console.error('source update: --enable and --disable are mutually exclusive');
          process.exitCode = 1;
          return;
        }
        const allowRegistries = parseAllowRegistries(opts.allowRegistry);
        // A patch: an omitted field is left alone. `--allow-registry` REPLACES the
        // stored list (so a glob can be corrected, not just appended to), and
        // `--clear-allow-registry` empties it back to the server baseline.
        const patch: UpdateCatalogSourceRequest = {
          ...(opts.name ? { name: opts.name } : {}),
          ...(opts.url ? { url: opts.url } : {}),
          ...(opts.registry && opts.cred ? { auth: { registry: opts.registry, credentialRef: opts.cred } } : {}),
          ...(opts.clearAllowRegistry ? { allowRegistries: [] } : allowRegistries.length > 0 ? { allowRegistries } : {}),
          ...(opts.enable ? { enabled: true } : opts.disable ? { enabled: false } : {}),
        };
        if (Object.keys(patch).length === 0) {
          console.error('source update: nothing to change (pass --name, --url, --registry + --cred, --allow-registry, --clear-allow-registry, --enable or --disable)');
          process.exitCode = 1;
          return;
        }
        const record = await sdk.catalogSources.update(id, patch);
        if (opts.json) console.log(JSON.stringify(record, null, 2));
        else {
          const allows = record.allowRegistries ?? [];
          const tail = [
            record.auth ? `auth: ${record.auth.credentialRef}` : '',
            allows.length > 0 ? `allow: ${allows.join(', ')}` : 'allow: (baseline only)',
            record.enabled ? '' : 'disabled',
          ].filter(Boolean).join(' · ');
          console.log(`Updated catalog source '${record.id}' → ${record.url} (${tail}).`);
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
        console.error(`Unknown action '${action}'. Use: add | list | update | rm`);
        process.exitCode = 1;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`source ${action} failed: ${msg}`);
    process.exitCode = 1;
  }
}
