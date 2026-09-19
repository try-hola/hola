/**
 * Resolving what an upgrade should target, in the presence of a cached catalog.
 *
 * Extracted from the promote route so the retry rule is testable on its own.
 */
import type { CatalogService } from './catalog';
import type { DeploymentService } from './deployment';
import type { GetDeploymentResponse } from '@hola/shared';

export interface ResolvedUpgradeTarget {
  /** The version to promote to, or undefined when there is nothing newer. */
  version?: string;
  /** The channel the deployment follows, carried through the draft round-trip. */
  channel: string;
  /** The deployment detail the decision was made against — re-read if the
   *  catalog was refreshed, so the caller compares against the same facts. */
  detail: GetDeploymentResponse;
  /** Whether the catalog was refreshed to reach this answer (for logging). */
  refreshed: boolean;
}

/**
 * Resolve an upgrade target, refreshing the catalog before concluding there is
 * nothing to do (#464).
 *
 * `latestVersion` is derived from the CACHED catalog index, whose refresh
 * interval defaults to 24h. Publishing a version and rolling it out straight
 * away — the normal shape of catalog work — therefore used to resolve to the
 * version already installed, and the route would rebuild a draft for it and
 * re-promote it: an upgrade that upgraded nothing, reported as success.
 *
 * So when the inferred target is missing or equal to what is running, refresh
 * once and ask again. That is a single catalog.json GET, paid only on the path
 * where the answer is "nothing to do" and therefore where being wrong is
 * indistinguishable from being right. An upgrade that already has somewhere to
 * go pays nothing.
 *
 * An explicitly requested version skips all of this: the caller has said what
 * they want, including re-promoting the version already running (a legitimate
 * way to repair a broken release).
 *
 * A refresh failure is swallowed — the catalog being unreachable is exactly the
 * other reason there may be nothing newer, and the caller's own "nothing to
 * promote to" handling already says so.
 */
export async function resolveUpgradeTargetFresh(
  services: { deployments: DeploymentService; catalog: Pick<CatalogService, 'refresh'> },
  deploymentId: string,
  requested: string | undefined,
  detail: GetDeploymentResponse,
  onRefresh?: (reason: string) => void,
): Promise<ResolvedUpgradeTarget> {
  const first = await services.deployments.resolveUpgradeTarget(deploymentId, requested, { detail });
  if (requested) return { ...first, detail, refreshed: false };
  if (first.version && first.version !== detail.version) return { ...first, detail, refreshed: false };

  onRefresh?.(first.version ? `target ${first.version} equals the installed version` : 'no newer version in the cached catalog');
  try {
    await services.catalog.refresh(true);
  } catch {
    return { ...first, detail, refreshed: false };
  }

  // Re-read: `latestVersion` is computed against the catalog at read time, so
  // the stale detail above cannot be reused for the second resolution.
  const fresh = await services.deployments.getDeployment(deploymentId);
  const second = await services.deployments.resolveUpgradeTarget(deploymentId, undefined, { detail: fresh });
  return { ...second, detail: fresh, refreshed: true };
}
