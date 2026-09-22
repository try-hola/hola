/**
 * A pinned map of contract ref -> provider grant kind, so changing an EXISTING
 * contract's privilege cannot pass review silently (#496).
 *
 * #496 fixed the runtime consequence: an install's consented grant kinds are
 * now frozen at consent time, so widening a shipped contract's `providerGrant`
 * no longer reaches installs that consented before the change. This guard is
 * the other half — it makes the mistake visible at review time instead of
 * arriving as a warning on somebody's host weeks later, and it keeps the
 * runtime mismatch path near-unreachable rather than merely survivable.
 *
 * **Every change to the table fails this test**, including legitimate ones. That
 * is deliberate: the pinned map has to be edited by hand, in the same commit,
 * which is the point at which someone reads what they are about to change.
 * Measured behaviour for each kind of edit:
 *
 *  - **Editing `providerGrant.kind` on a shipped ref**, or adding a
 *    `providerGrant` to a ref that had none: fails the equality test. This is
 *    the hazard — it silently re-describes a privilege operators already
 *    consented to under different terms. Do not "fix" it by updating `PINNED`;
 *    bump the contract's version instead.
 *  - **Adding a new contract**: fails with the new ref in the diff (`+
 *    "demo@1": null`). Legitimate — a new ref has no prior consent to widen.
 *    Pin it and move on.
 *  - **Bumping a version** (`backup@1` -> `backup@2`): fails twice, and the
 *    second failure is the useful one. It reports that `backup@1` is pinned but
 *    gone, because every install that consented to `backup@1` now holds a
 *    recorded privilege that no longer resolves — they silently lose the
 *    access, which is exactly the consequence a version bump is supposed to
 *    make you think about. ADR 0004 treats a bump as "the acceptor's
 *    obligations changed"; this makes the provider side of that visible too.
 */
import { describe, test, expect } from 'bun:test';

import { CONTRACTS, formatContractRef, type ProviderGrantKind } from '@hola/shared/contracts';

/**
 * Every shipped contract ref and the privilege it grants — `null` for a
 * contract that grants none.
 *
 * DO NOT edit an existing line to change a kind. Bump that contract's version
 * instead and add the new ref here; see the file header for why.
 */
const PINNED: Readonly<Record<string, ProviderGrantKind | null>> = {
  'auth@1': null,
  'backup@1': 'apps-data',
  'push@1': null,
  'container-logs@1': 'container-logs',
  'restore@1': 'restore-staging',
};

function liveGrantKinds(): Record<string, ProviderGrantKind | null> {
  const out: Record<string, ProviderGrantKind | null> = {};
  for (const def of CONTRACTS) out[formatContractRef(def)] = def.providerGrant?.kind ?? null;
  return out;
}

describe('contract grant kinds are pinned (#496)', () => {
  test('no shipped contract has changed the privilege it grants', () => {
    // One equality rather than a per-ref loop: it catches a changed kind, a new
    // contract nobody pinned, and a removed one, with the whole map in the diff.
    expect(liveGrantKinds()).toEqual(PINNED as Record<string, ProviderGrantKind | null>);
  });

  test('every pinned ref still exists in the table', () => {
    const live = liveGrantKinds();
    for (const ref of Object.keys(PINNED)) {
      expect(
        Object.prototype.hasOwnProperty.call(live, ref),
        `'${ref}' is pinned but no longer in CONTRACTS. Removing a contract strands ` +
          `every install that consented to it — its recorded privilege stops resolving ` +
          `and the app silently loses access. If that is intended, say so here.`,
      ).toBe(true);
    }
  });

  test('a contract that grants a privilege describes it to the operator', () => {
    // The pinning above protects the KIND. The label and risk text are what the
    // operator actually reads when consenting, so an empty one makes the consent
    // row meaningless even though the kind is unchanged.
    for (const def of CONTRACTS) {
      if (!def.providerGrant) continue;
      const ref = formatContractRef(def);
      expect(def.providerGrant.label.trim().length, `${ref} has an empty grant label`).toBeGreaterThan(0);
      expect(def.providerGrant.risk.trim().length, `${ref} has an empty grant risk`).toBeGreaterThan(0);
    }
  });
});
