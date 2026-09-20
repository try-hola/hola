/**
 * Restore-on-install candidate resolution (spec 007).
 *
 * Pure functions over already-fetched state — no I/O, no app names
 * (Constitution III, V). Callers (the candidates route, `draft.ts`,
 * `deployment.ts`) do the filesystem/deployment-registry reads and pass in
 * plain data; this module never touches a filesystem, a catalog, or a
 * datastore, and never branches on which app is being restored. That last
 * property is mechanically checked by quickstart.md §9's scope-boundary grep
 * (a case-insensitive search of this file for any specific catalog app's or
 * datastore's name) — deliberately not spelled out literally here, so this
 * very comment can't produce a false positive against that check.
 */

import {
  checkUpgradePath,
  isNewerVersion,
  type AppEnvVar,
  type AppUpgradeMeta,
  type EnhancedDeploymentDetail,
  type RestoreCandidate,
  type RestoreCandidateLineage,
  type RestoreRefusalCode,
  type RestoreSkewVerdict,
  type RestoreWarning,
  type RestoreChoice,
} from '@hola/shared';

/**
 * The subset of the install identity record (`.hola/instance.json`, spec 006)
 * this module reads. Deliberately NOT the `InstallIdentityRecord` type in
 * `deployment.ts` — that type is module-local by design (spec 006, FR-018:
 * "nothing outside the server reads this record"), and this module stays a
 * pure function of already-fetched state: the caller reads and parses the
 * file, and hands in only the fields a candidate description needs.
 */
export interface RestoreIdentitySnapshot {
  lineageId?: string;
  app?: string;
  appVersion?: string | null;
  channel?: string | null;
  subdomain?: string | null;
  host?: string | null;
  writtenAt?: string | null;
}

/** One deployment considered as a restore source, with the I/O already done by the caller. */
export interface CandidateSource {
  deployment: EnhancedDeploymentDetail;
  /** Parsed `.hola/instance.json`, or `null` when absent/unparseable (FR-003). */
  identity: RestoreIdentitySnapshot | null;
  /** `dirHasContents(appRoot, [INSTALL_MARKERS_DIR])` — whether the data root holds app data. */
  hasData: boolean;
  /** Whether `<appsBindRoot>/.hola/<id>/env.json` exists for this deployment. */
  carriesEnv: boolean;
}

/** Settled deployment states a restore may read from (FR-004a). Mid-lifecycle and `error` are excluded. */
const SETTLED_STATUSES = new Set(['running', 'stopped']);

export function isSettledStatus(status: string): boolean {
  return SETTLED_STATUSES.has(status);
}

/**
 * Eligibility (data-model.md §2, FR-001/FR-004/FR-004a). A deployment is a
 * candidate iff: same app, not the deployment being created, settled state,
 * and its data root holds app data ignoring the marker directory. The
 * ignore-list is load-bearing — the caller must compute `hasData` with the
 * same `dirHasContents(appRoot, [INSTALL_MARKERS_DIR])` rule
 * `capturePreUpgradeSnapshot` already applies, or every materialised install
 * looks like it holds data (the data-loss shape spec 006's review caught).
 */
export function isEligibleCandidate(
  source: CandidateSource,
  targetAppId: string,
  excludeDeploymentId?: string,
): boolean {
  const { deployment, hasData } = source;
  if (deployment.app !== targetAppId) return false;
  if (excludeDeploymentId && deployment.id === excludeDeploymentId) return false;
  if (!isSettledStatus(deployment.status)) return false;
  if (!hasData) return false;
  return true;
}

/**
 * Describe a candidate from its identity record, falling back per-field to
 * the deployment record (FR-003). `lineageId` degrades to the deployment id
 * when the identity record is absent or lacks one — the field with no
 * deployment-record fallback, because `lineageId` was only persisted onto the
 * deployment record by this feature (research R4); a pre-existing identity
 * record already carries it (spec 006 wrote it in anticipation).
 */
export function describeCandidate(
  source: CandidateSource,
): Omit<RestoreCandidate, 'skew' | 'requiredAcknowledgements' | 'warnings'> {
  const { deployment, identity, carriesEnv } = source;
  return {
    deploymentId: deployment.id,
    lineageId: identity?.lineageId ?? deployment.lineageId ?? deployment.id,
    app: identity?.app ?? deployment.app,
    name: deployment.name,
    subdomain: identity?.subdomain ?? deployment.subdomain ?? null,
    host: identity?.host ?? null,
    appVersion: identity?.appVersion ?? deployment.version ?? null,
    channel: identity?.channel ?? deployment.channel ?? null,
    carriesEnv,
    capturedAt: identity?.writtenAt ?? null,
    hasIdentityRecord: identity !== null,
  };
}

/** Newest-first comparator on `capturedAt`; a null `capturedAt` sorts last (FR-005). */
function compareCapturedAtDesc(a: RestoreCandidate, b: RestoreCandidate): number {
  if (a.capturedAt === b.capturedAt) return 0;
  if (a.capturedAt === null) return 1;
  if (b.capturedAt === null) return -1;
  return a.capturedAt < b.capturedAt ? 1 : -1;
}

/**
 * Group candidates by lineage, newest-first within each lineage and across
 * lineages (FR-005, FR-036). A single matching lineage supplies a default
 * selection; two or more distinct lineages require an explicit pick and no
 * default is offered; zero lineages need no choice at all.
 */
export function groupIntoLineages(candidates: RestoreCandidate[]): {
  lineages: RestoreCandidateLineage[];
  defaultCandidateId: string | null;
  requiresExplicitChoice: boolean;
} {
  const byLineage = new Map<string, RestoreCandidate[]>();
  for (const candidate of candidates) {
    const list = byLineage.get(candidate.lineageId) ?? [];
    list.push(candidate);
    byLineage.set(candidate.lineageId, list);
  }

  const lineages: RestoreCandidateLineage[] = Array.from(byLineage.entries()).map(([lineageId, list]) => ({
    lineageId,
    candidates: [...list].sort(compareCapturedAtDesc),
  }));
  lineages.sort((a, b) => compareCapturedAtDesc(a.candidates[0]!, b.candidates[0]!));

  const requiresExplicitChoice = lineages.length >= 2;
  const defaultCandidateId = lineages.length === 1 ? (lineages[0]!.candidates[0]?.deploymentId ?? null) : null;

  return { lineages, defaultCandidateId, requiresExplicitChoice };
}

/**
 * Version skew (data-model.md §4, research R15). Evaluated in this exact
 * order. Only the two `refused` rows below come from `checkUpgradePath` —
 * "candidate newer than target" and "version/metadata unknown" are this
 * feature's OWN rules, evaluated first, because `checkUpgradePath` returns
 * `ok` for both: it exists to guard promotes, where a downgrade (which is
 * what a newer-than-target restore looks like to it) is the caller's
 * business, not something to block.
 */
export function computeSkewVerdict(
  candidateVersion: string | null | undefined,
  targetVersion: string | undefined,
  meta: AppUpgradeMeta | undefined,
): RestoreSkewVerdict {
  if (!candidateVersion || !targetVersion || !meta) return { kind: 'unknown' };

  if (isNewerVersion(candidateVersion, targetVersion)) {
    return {
      kind: 'refused',
      code: 'RESTORE_SOURCE_NEWER',
      message: `This candidate was captured on version ${candidateVersion}, newer than the version being installed (${targetVersion}).`,
    };
  }

  const pathResult = checkUpgradePath(candidateVersion, targetVersion, meta);
  if (!pathResult.ok) {
    return {
      kind: 'refused',
      code: 'RESTORE_UPGRADE_PATH',
      message: pathResult.message,
      suggestedVersion: pathResult.suggestedVersion,
    };
  }

  return { kind: 'ok' };
}

/**
 * Exactly the `AppEnvVar` entries where `isSecret === true` AND `generate` is
 * present (FR-033) — values the PLATFORM invented and will mint fresh when
 * not carried. Derived, never a manifest field an app author could forget or
 * let rot.
 */
export function deriveEnvNotCarriedKeys(appEnv: AppEnvVar[]): string[] {
  return appEnv.filter((entry) => entry.isSecret === true && entry.generate != null).map((entry) => entry.key);
}

export interface AcknowledgementInput {
  skew: RestoreSkewVerdict;
  carryEnv: boolean;
  carriesEnv: boolean;
}

/**
 * Which acknowledgement codes a candidate choice REQUIRES (data-model.md §3),
 * modelled on `grants`. Both `carryEnv === false` (declined) and
 * `carriesEnv === false` (unavailable) map to the SAME code deliberately —
 * the operator-facing risk is identical either way, and a second code would
 * invite treating one as less serious.
 */
export function deriveRequiredAcknowledgements(input: AcknowledgementInput): string[] {
  const required: string[] = [];
  if (input.skew.kind === 'unknown') required.push('restore-version-unknown');
  if (!input.carryEnv || !input.carriesEnv) required.push('restore-env-not-carried');
  return required;
}

export interface WarningsInput {
  carryEnv: boolean;
  carriesEnv: boolean;
  envNotCarriedKeys: string[];
  hasIdentityRecord: boolean;
  candidateSubdomain?: string | null;
  chosenSubdomain?: string | null;
}

/** Proceedable, named, non-fatal risks to surface alongside a candidate (data-model.md §5). */
export function deriveWarnings(input: WarningsInput): RestoreWarning[] {
  const warnings: RestoreWarning[] = [];
  if ((!input.carryEnv || !input.carriesEnv) && input.envNotCarriedKeys.length > 0) {
    warnings.push({ code: 'env-not-carried', keys: input.envNotCarriedKeys });
  }
  if (!input.hasIdentityRecord) {
    warnings.push({ code: 'no-identity-record' });
  }
  if (
    input.candidateSubdomain != null &&
    input.chosenSubdomain != null &&
    input.candidateSubdomain !== input.chosenSubdomain
  ) {
    warnings.push({ code: 'host-divergence', from: input.candidateSubdomain, to: input.chosenSubdomain });
  }
  return warnings;
}

/**
 * Resolve one candidate's full listing shape (`skew`, `requiredAcknowledgements`,
 * `warnings`) for the candidates ROUTE, before the operator has made a
 * `RestoreChoice`. The route assumes the DEFAULT action — carry configuration
 * whenever it's available (`carryEnv: candidate.carriesEnv`) — which is why
 * `requiredAcknowledgements` is empty for a candidate with an environment
 * record and an `ok` skew: that's the shape of accepting the defaults. A
 * client that instead declines carrying (or picks a candidate with no record)
 * gets `restore-env-not-carried` required at create time via
 * {@link deriveRequiredAcknowledgements} evaluated against the actual choice.
 */
export function resolveListedCandidate(
  source: CandidateSource,
  targetVersion: string | undefined,
  meta: AppUpgradeMeta | undefined,
  appEnv: AppEnvVar[],
): RestoreCandidate {
  const described = describeCandidate(source);
  const skew = computeSkewVerdict(described.appVersion, targetVersion, meta);
  const envNotCarriedKeys = deriveEnvNotCarriedKeys(appEnv);
  const assumedCarryEnv = described.carriesEnv; // the route's default action
  const requiredAcknowledgements = deriveRequiredAcknowledgements({
    skew,
    carryEnv: assumedCarryEnv,
    carriesEnv: described.carriesEnv,
  });
  const warnings = deriveWarnings({
    carryEnv: assumedCarryEnv,
    carriesEnv: described.carriesEnv,
    envNotCarriedKeys,
    hasIdentityRecord: described.hasIdentityRecord,
  });
  return { ...described, skew, requiredAcknowledgements, warnings };
}

/**
 * Whether a previously-chosen candidate is STILL a valid restore source,
 * re-checked at job time because it may have been deleted or started a
 * lifecycle action since the draft was created (FR-013a, research R8 step 2).
 * `source` is `undefined` when the deployment no longer exists at all.
 */
export function checkCandidateStillEligible(
  source: CandidateSource | undefined,
  targetAppId: string,
  excludeDeploymentId: string,
): { ok: true } | { ok: false; code: 'RESTORE_CANDIDATE_GONE' | 'RESTORE_CANDIDATE_BUSY' } {
  if (!source) return { ok: false, code: 'RESTORE_CANDIDATE_GONE' };
  if (source.deployment.app !== targetAppId) return { ok: false, code: 'RESTORE_CANDIDATE_GONE' };
  if (source.deployment.id === excludeDeploymentId) return { ok: false, code: 'RESTORE_CANDIDATE_GONE' };
  if (!isSettledStatus(source.deployment.status)) return { ok: false, code: 'RESTORE_CANDIDATE_BUSY' };
  return { ok: true };
}

export interface RestoreNameDefaults {
  name: string;
  subdomain: string;
  warnings: RestoreWarning[];
}

export type RestoreNameResolution =
  | ({ ok: true } & RestoreNameDefaults)
  | { ok: false; code: RestoreRefusalCode; message: string; details: Record<string, unknown> };

/**
 * FR-035: default a restored install's name/subdomain from the candidate
 * when the operator supplied no explicit name, and warn when an explicit
 * choice diverges from the candidate's own address — absolute addresses
 * stored inside the restored data will not be rewritten. Pure: the caller's
 * own `deriveSubdomain` is injected rather than imported, so this stays a
 * function of its arguments (Constitution III/V) and is directly testable
 * without the routing/collision machinery a real install exercises.
 *
 * **The address the default lands on can be occupied (#490).** A restore
 * candidate is by definition a deployment that still exists on this host, and
 * a deployment owns its route whether it is running or stopped — so FR-035's
 * "default from the candidate's recorded address" resolves, whenever the
 * candidate still routes under that address, onto an address that is taken.
 * `candidateLiveSubdomain` is the label the candidate ACTUALLY routes under
 * right now (its deployment record's, not its identity record's, which can be
 * stale); when the resolved default equals it, this refuses with
 * `RESTORE_ADDRESS_REQUIRED` instead of returning an address the create is
 * guaranteed to reject a few lines later with a bare routing `CONFLICT` that
 * names no candidate and mentions no restore (FR-037).
 *
 * The refusal fires ONLY when the operator supplied nothing. An operator who
 * names the install has made the address decision, collision included, and
 * gets the routing layer's own conflict — which names the owning deployment.
 *
 * REJECTED alternative, deliberately not implemented: deriving a distinct
 * (e.g. suffixed) slug so the default always succeeds. That silently creates
 * an install at a NEW address holding data full of the OLD address's absolute
 * URLs — manufacturing exactly the divergence the `host-divergence` warning
 * exists to WARN about, without the operator ever choosing it. An address is
 * an operator decision; when the default cannot be honoured, the operator has
 * to make it.
 */
export function resolveRestoreNameDefaults(input: {
  requestedName: string | undefined;
  candidateId: string;
  candidateName: string;
  candidateSubdomain: string | null;
  /** The label the candidate deployment routes under today, or `null` if it routes nowhere. */
  candidateLiveSubdomain: string | null;
  appId: string;
  deriveSubdomain: (name: string | undefined, appId: string) => string;
}): RestoreNameResolution {
  const name = input.requestedName || input.candidateName;
  const subdomain = !input.requestedName && input.candidateSubdomain
    ? input.candidateSubdomain
    : input.deriveSubdomain(name, input.appId);

  if (!input.requestedName && input.candidateLiveSubdomain && subdomain === input.candidateLiveSubdomain) {
    return {
      ok: false,
      code: 'RESTORE_ADDRESS_REQUIRED',
      message:
        `Restoring from '${input.candidateName}' (${input.candidateId}) would default this install to ` +
        `'${subdomain}', the address that candidate still uses. Give the new install its own name or ` +
        `subdomain — addresses stored inside the restored data still point at '${subdomain}'.`,
      details: {
        candidateId: input.candidateId,
        candidateName: input.candidateName,
        subdomain,
      },
    };
  }

  const warnings: RestoreWarning[] = [];
  if (input.candidateSubdomain && input.candidateSubdomain !== subdomain) {
    warnings.push({ code: 'host-divergence', from: input.candidateSubdomain, to: subdomain });
  }
  return { ok: true, name, subdomain, warnings };
}

/**
 * Which "the target data root is not empty" refusal a restore is looking at
 * (#489, FR-014). Both refuse — FR-022 forbids starting an app on a data root
 * the platform cannot vouch for, and that is the right answer in both cases —
 * but they describe different states and have different recoveries, so they
 * are different codes.
 *
 * `restoreStartedAt` is the discriminator: it is persisted immediately before
 * the extraction that wipes and rewrites the root, so its presence means THIS
 * install's own restore already wrote here and then failed somewhere after.
 * Absent, the data predates this install's restore entirely.
 *
 * Two REJECTED alternatives, deliberately not implemented — do not re-propose
 * them:
 *
 *  - Persisting an attempted-marker (or `restoredAt`) before extraction so a
 *    RETRY takes the no-restore path and brings the app up on whatever landed.
 *    A genuinely half-extracted tree would then start: the silent-empty-app
 *    failure FR-022 exists to forbid, and the worst outcome named in the
 *    spec's Executive Summary. `restoreStartedAt` here is a diagnostic only —
 *    it changes the WORDS of the refusal, never the fact of it.
 *  - Letting a retry re-run the post-extraction steps only (discards, marker
 *    rewrite, hooks). Nothing can distinguish "extraction completed and a
 *    discard failed" from "extraction died halfway", so re-running discards
 *    and hooks risks operating on a partial tree — the same failure by a
 *    longer route.
 */
export function classifyNonEmptyTarget(input: {
  deploymentId: string;
  deploymentName: string;
  restoreStartedAt: string | undefined;
}): { code: RestoreRefusalCode; message: string; details: Record<string, unknown> } {
  if (input.restoreStartedAt) {
    return {
      code: 'RESTORE_INCOMPLETE',
      message:
        `Cannot restore into '${input.deploymentName}': its own restore already wrote data here at ` +
        `${input.restoreStartedAt} and then failed, so the data root holds a partially restored copy. ` +
        `That data is still on disk and is NOT safe to start against. Uninstall and reinstall this app ` +
        `to retry the restore, or clear its data root first if you want to keep this install.`,
      details: { deploymentId: input.deploymentId, restoreStartedAt: input.restoreStartedAt },
    };
  }
  return {
    code: 'RESTORE_TARGET_NOT_EMPTY',
    message: `Cannot restore into '${input.deploymentName}': its data root already holds app data.`,
    details: { deploymentId: input.deploymentId },
  };
}

export interface RestoreValidationInput {
  /** The candidate, already resolved with `skew` computed against `targetVersion`. */
  candidate: RestoreCandidate;
  /** The operator's decision. */
  choice: RestoreChoice;
  /** The app's `restore.requiresEnv` declaration for the participation(s) in play. Default `false`. */
  requiresEnv: boolean;
  /** `deriveEnvNotCarriedKeys` for the version being installed — the `missingKeys` a `RESTORE_ENV_REQUIRED` refusal names. */
  envNotCarriedKeys: string[];
  targetVersion?: string;
}

export type RestoreValidationResult =
  | { ok: true; requiredAcknowledgements: string[] }
  | { ok: false; code: RestoreRefusalCode; message: string; details: Record<string, unknown> };

/**
 * The one place that turns a candidate + a choice into "proceed" or "refuse
 * with this code" (data-model.md §3/§4). Reused verbatim at draft creation
 * (T015), at `createFromDraft` re-validation (T018), and at job-time
 * re-resolution (T051) — the checks are identical each time; only WHEN they
 * run, and what a candidate looks like when re-resolved, differs.
 *
 * A refusal is never acknowledgeable (FR-029, FR-030, FR-034) — only rows
 * that reach the acknowledgement check below are.
 */
export function validateRestoreChoice(input: RestoreValidationInput): RestoreValidationResult {
  const { candidate, choice, requiresEnv, envNotCarriedKeys, targetVersion } = input;

  if (candidate.skew.kind === 'refused') {
    const details: Record<string, unknown> = {};
    if (candidate.skew.code === 'RESTORE_SOURCE_NEWER') {
      details.candidateVersion = candidate.appVersion;
      details.targetVersion = targetVersion;
    } else if (candidate.skew.suggestedVersion) {
      details.suggestedVersion = candidate.skew.suggestedVersion;
    }
    return { ok: false, code: candidate.skew.code, message: candidate.skew.message, details };
  }

  // FR-034: `requiresEnv` turns the missing-environment-record WARNING into a
  // REFUSAL — never acknowledgeable, because the app has said it cannot
  // sensibly restore without its configuration.
  const carriesUsable = choice.carryEnv && candidate.carriesEnv;
  if (requiresEnv && !carriesUsable) {
    return {
      ok: false,
      code: 'RESTORE_ENV_REQUIRED',
      message: 'This app requires its captured configuration to restore, and the chosen candidate has none carried.',
      details: { missingKeys: envNotCarriedKeys },
    };
  }

  const required = deriveRequiredAcknowledgements({
    skew: candidate.skew,
    carryEnv: choice.carryEnv,
    carriesEnv: candidate.carriesEnv,
  });
  const acknowledged = new Set(choice.acknowledge ?? []);
  const missing = required.filter((code) => !acknowledged.has(code));
  if (missing.length > 0) {
    return {
      ok: false,
      code: 'RESTORE_ACK_REQUIRED',
      message: `This restore needs acknowledgement of: ${missing.join(', ')}.`,
      details: { required: missing },
    };
  }

  return { ok: true, requiredAcknowledgements: required };
}

export interface JudgeRestoreChoiceInput {
  /** Already-fetched candidate state, or `undefined` if the id names no deployment at all. */
  source: CandidateSource | undefined;
  appId: string;
  excludeDeploymentId: string;
  choice: RestoreChoice;
  targetVersion: string | undefined;
  meta: AppUpgradeMeta | undefined;
  requiresEnv: boolean;
  envNotCarriedKeys: string[];
}

export type JudgeRestoreChoiceResult =
  | { ok: true; candidate: RestoreCandidate; requiredAcknowledgements: string[] }
  | { ok: false; code: RestoreRefusalCode; message: string; details: Record<string, unknown> };

/**
 * Resolve + validate a restore choice against already-fetched state — the ONE
 * function draft creation (T015), `createFromDraft`'s re-validation (T018),
 * and the deploy job's job-time re-resolution (T051, FR-013a) all call.
 * Composes {@link checkCandidateStillEligible}, {@link describeCandidate},
 * {@link computeSkewVerdict} and {@link validateRestoreChoice} — only WHEN
 * this runs, and whether `source` might already be stale, differs between
 * callers.
 */
export function judgeRestoreChoice(input: JudgeRestoreChoiceInput): JudgeRestoreChoiceResult {
  const eligibility = checkCandidateStillEligible(input.source, input.appId, input.excludeDeploymentId);
  if (!eligibility.ok) {
    return {
      ok: false,
      code: eligibility.code,
      message: `Restore source '${input.choice.candidateId}' is not available (${eligibility.code}).`,
      details: { candidateId: input.choice.candidateId },
    };
  }
  const described = describeCandidate(input.source!);
  const skew = computeSkewVerdict(described.appVersion, input.targetVersion, input.meta);
  const candidate: RestoreCandidate = { ...described, skew, requiredAcknowledgements: [], warnings: [] };

  const result = validateRestoreChoice({
    candidate,
    choice: input.choice,
    requiresEnv: input.requiresEnv,
    envNotCarriedKeys: input.envNotCarriedKeys,
    targetVersion: input.targetVersion,
  });
  if (!result.ok) return result;
  return { ok: true, candidate, requiredAcknowledgements: result.requiredAcknowledgements };
}
