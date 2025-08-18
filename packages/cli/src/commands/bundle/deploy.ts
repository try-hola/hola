import { HolaSdk } from '@hola/sdk';
import type { CreateDraftResponse } from '@hola/shared';

export async function runBundleDeploy(opts: { path?: string; appId?: string; version?: string; traefik?: boolean; noStream?: boolean }) {
  const sdk = new HolaSdk();
  // Minimal stub: create draft -> validate -> finalize -> (server deploy via existing endpoints not yet exposed)
  const appId = opts.appId ?? 'app-dev';
  const version = opts.version ?? 'dev';
  const draft = (await sdk.drafts.create({ appId, version })) as CreateDraftResponse;
  await sdk.drafts.validate(draft.draftId);
  await sdk.drafts.preflight(draft.draftId);
  await sdk.drafts.finalize(draft.draftId);
  console.log('Draft finalized. Server-side deploy action will be added next.');
}
