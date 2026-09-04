import { HolaSdk } from '@hola/sdk';
import { STABLE_CHANNEL } from '@hola/shared';
import type { GetCatalogAppsResponse } from '@hola/shared';

import { maybeNotifyUpdate } from '../../lib/update-notice';

export interface CatalogOptions {
  category?: string;
  source?: string;
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
      source: opts.source,
      page: 1,
      limit: Number.isFinite(limit) ? limit : 100,
    })) as GetCatalogAppsResponse;

    if (opts.json) {
      console.log(JSON.stringify(res, null, 2));
      return;
    }

    if (!res.items.length) {
      console.log('No apps found. (Is HOLA_CATALOG_URL set on the server?)');
      await maybeNotifyUpdate(sdk, opts);
      return;
    }

    const idWidth = Math.max(3, ...res.items.map(a => a.id.length));
    for (const app of res.items) {
      // Badge apps from a non-default source so their origin/trust is visible.
      const badge = app.source && app.source !== 'hola' ? `  [${app.source}·${app.trust}]` : '';
      // #428: apps offering a channel beyond stable, e.g. "(channels: rc)".
      const nonStableChannels = (app.channels ?? []).filter(c => c !== STABLE_CHANNEL);
      const channels = nonStableChannels.length ? `  (channels: ${nonStableChannels.join(', ')})` : '';
      console.log(`${(app.icon || '📦')} ${app.id.padEnd(idWidth)}  ${app.description}${badge}${channels}`);
    }
    console.log(`\n${res.total} app(s). Install with: hola install <id> [--source <source>]`);
    await maybeNotifyUpdate(sdk, opts);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Catalog list failed: ${msg}`);
    if (/fetch failed|ECONNREFUSED|network|connect/i.test(msg)) console.error('Hint: set HOLA_API_URL (default http://localhost:3001).');
    process.exitCode = 1;
  }
}
