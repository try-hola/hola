import { HolaSdk } from '@hola/sdk';
import type { GetCatalogAppsResponse } from '@hola/shared';

export interface CatalogOptions {
  category?: string;
  limit?: number | string;
  json?: boolean;
}

/** List/search the app catalog (GET /api/catalog/apps). */
export async function runCatalog(
  query: string | undefined,
  opts: CatalogOptions,
  injected?: { sdk?: HolaSdk }
): Promise<void> {
  const sdk = injected?.sdk ?? new HolaSdk();
  try {
    const limit = opts.limit !== undefined ? Number(opts.limit) : 100;
    const res = (await sdk.catalog.apps({
      q: query,
      category: opts.category,
      page: 1,
      limit: Number.isFinite(limit) ? limit : 100,
    })) as GetCatalogAppsResponse;

    if (opts.json) {
      console.log(JSON.stringify(res, null, 2));
      return;
    }

    if (!res.items.length) {
      console.log('No apps found. (Is HOLA_CATALOG_URL set on the server?)');
      return;
    }

    const idWidth = Math.max(3, ...res.items.map(a => a.id.length));
    for (const app of res.items) {
      console.log(`${(app.icon || '📦')} ${app.id.padEnd(idWidth)}  ${app.description}`);
    }
    console.log(`\n${res.total} app(s). Install with: hola install <id>`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Catalog list failed: ${msg}`);
    if (/fetch failed|ECONNREFUSED|network|connect/i.test(msg)) console.error('Hint: set HOLA_API_URL (default http://localhost:3001).');
    process.exitCode = 1;
  }
}
