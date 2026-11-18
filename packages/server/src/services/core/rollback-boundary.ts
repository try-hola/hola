/**
 * Pure rollback judgements (#584), kept apart from the deployment service so
 * the rules can be tested as a table: which releases in a rollback's range
 * are one-way upgrade boundaries, and which release a rollback with no
 * explicit target moves to.
 */
import type { AppUpgradeMeta } from '@hola/shared';
import { compareVersions } from '@hola/shared';

/** A release's version and upgrade block, as its finalized manifest states them. */
export interface VersionedUpgrade {
  version: string;
  upgrade?: AppUpgradeMeta;
}

/** Whether a version string has a numeric order to judge (`latest` does not). */
export function isOrderedVersion(v: string | undefined): v is string {
  return !!v && /^v?\d/.test(v.trim());
}

/** The packager's statement that an upgrade migrates data an older version cannot read. */
export function declaresOneWay(u: AppUpgradeMeta | undefined): boolean {
  return u?.preUpgradeBackup === 'required' || u?.breaking === true;
}

/**
 * The fields of an upgrade block that describe a migration, normalised so a
 * missing field and its default compare equal (`breaking` absent ≡ false,
 * `preUpgradeBackup` absent ≡ `none`, no waypoints ≡ `[]`). `upgradeNotesUrl`
 * is deliberately left out: it is a link, not a statement about the data.
 */
export function upgradeSignature(u: AppUpgradeMeta | undefined): string {
  return JSON.stringify({
    breaking: u?.breaking === true,
    preUpgradeBackup: u?.preUpgradeBackup ?? 'none',
    minFromVersion: u?.minFromVersion?.trim() || null,
    waypoints: [...(u?.waypoints ?? [])].map((w) => w.trim()).sort(compareVersions),
  });
}

function majorOf(v: string): string {
  return /^v?(\d+)/.exec(v.trim())?.[1] ?? '';
}

/**
 * The migration a release's upgrade block describes, for comparing two
 * releases: its normalised block plus its major version. The major is part of
 * the identity because the catalog copies a major's block onto that major's
 * later patch bumps verbatim — so within a major an identical block is the
 * same migration repeated — but two majors that happen to declare the same
 * block are two migrations.
 */
function migrationKey(r: VersionedUpgrade): string {
  return `${majorOf(r.version)}|${upgradeSignature(r.upgrade)}`;
}

/**
 * The versions in `inRange` (releases this deployment ran, with a version in
 * (target, current]) that are one-way upgrade boundaries for a rollback to
 * `target`. Empty ⇒ no boundary.
 *
 * A release counts only if it declares a one-way upgrade (`breaking: true` or
 * `preUpgradeBackup: "required"`) AND that declaration is not the TARGET's own:
 * the catalog copies a major's `upgrade` block onto every patch bump of that
 * major (gitea 2.0.1/2.0.2 carry 2.0.0's `breaking: true`), so a block
 * identical to the target's — same major — describes a migration the data had
 * already been through before the target ran. Comparing against the target,
 * not against each release's neighbour, is what keeps 2.0.2 → 2.0.4 (no block)
 * → 2.0.5 (2.0.0's block again) rolling back to 2.0.2 from being refused.
 *
 * Several releases repeating one migration are reported once, at the lowest
 * version (1.x → 2.0.0 → 2.0.1 back to 1.x reports 2.0.0, not both).
 */
export function oneWayBoundaries(target: VersionedUpgrade, inRange: readonly VersionedUpgrade[]): string[] {
  const targetKey = migrationKey(target);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of [...inRange].sort((a, b) => compareVersions(a.version, b.version))) {
    if (!declaresOneWay(r.upgrade)) continue;
    const key = migrationKey(r);
    if (key === targetKey || seen.has(key)) continue;
    seen.add(key);
    if (!out.includes(r.version)) out.push(r.version);
  }
  return out;
}

/** A release as the default-target choice sees it. */
export interface RollbackCandidate {
  id: string;
  createdAt: string;
  /** Undefined when the release's version cannot be read. */
  version?: string;
}

/**
 * The release a rollback with no explicit target moves to: the most recently
 * created release whose version differs from the active release's.
 *
 * "Most recently created other release" alone is wrong after
 * upgrade(3.0.0) → rollback(2.0.2) → upgrade(3.0.0 again): the newest other
 * release is the FIRST 3.0.0, and "rolling back" to it replaces 3.0.0 with
 * 3.0.0. A release whose version is unknown counts as different (it cannot be
 * shown to be the same). When the active version is unknown, or every other
 * release shares it, this is the newest other release — the pre-fix behaviour.
 */
export function pickDefaultRollbackTarget(
  candidates: readonly RollbackCandidate[],
  activeReleaseId: string | undefined,
  activeVersion: string | undefined,
): string | undefined {
  const others = candidates
    .filter((c) => c.id !== activeReleaseId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  if (others.length === 0) return undefined;
  if (activeVersion) {
    const differing = others.find((c) => !c.version || c.version !== activeVersion);
    if (differing) return differing.id;
  }
  return others[0].id;
}
