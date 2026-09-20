import { HolaSdk } from '@hola/sdk';
import { STABLE_CHANNEL } from '@hola/shared';
import type { CreateDraftResponse, GetDraftResponse, AppEnvVar, ListRestoreCandidatesResponse, RestoreCandidate, RestoreChoice } from '@hola/shared';
import { validateParams, generateSecretValue } from '@hola/shared/param-validate';

import { finalizeAndDeploy, reportDeployError, DeployAbort, type DeployResult } from '../../lib/deploy-flow';
import { maybeNotifyUpdate } from '../../lib/update-notice';

export interface InstallOptions {
  /** From `--app-version`. Not `--version` — that's sade's global flag and never reaches us. */
  appVersion?: string;
  name?: string;
  set?: string | string[];
  noStream?: boolean;
  json?: boolean;
  strict?: boolean;
  /** From `--registry-cred`: stored credential id for a private OCI ref install. */
  registryCred?: string;
  /** From `--source`: catalog source id to install from (default: hola). */
  source?: string;
  /**
   * From `--no-generate-secrets`: don't auto-fill empty secrets that carry a
   * manifest `generate` recipe — leave them empty so they hit validation with
   * an actionable "provide --set" message instead of being silently
   * randomized. For operators who always intend to pass every secret explicitly
   * (reproducible/scripted installs).
   */
  noGenerateSecrets?: boolean;
  /**
   * From `--allow-multiple`: install a second instance of an app the catalog marks
   * single-instance (#246). The server rejects a duplicate install by default;
   * this bypasses that guard. Still needs a distinct `--name` (→ distinct
   * subdomain), or the install fails with a host conflict.
   */
  allowMultiple?: boolean;
  /**
   * From `--profile <key>` (repeatable): Compose profiles to enable for this
   * install (#162), each activating an optional service the app declares (e.g.
   * `elasticsearch`). Also accepts a comma-separated list in one flag. When
   * omitted, the app's manifest-default profiles are used. Unknown keys are
   * ignored server-side (intersected with the declared set).
   */
  profile?: string | string[];
  /**
   * From `--grant <contract>` (repeatable): consent to a privileged capability
   * contract the app declares in its manifest `provides` — e.g. `backup@1`,
   * which lets a backup app read every other app's data (ADR 0004 §4).
   *
   * Required, not optional: the server refuses to install an app whose declared
   * grant nobody consented to, rather than installing it without the access it
   * needs. A backup tool that silently protects nothing is the failure this
   * prevents. The error names the exact flag to re-run with.
   */
  grant?: string | string[];
  /**
   * From `--channel <name>` (#428): the release channel to follow. `latest`
   * (the default when no version is pinned) resolves to the newest version
   * eligible on this channel. Default: `stable`, or the pinned version's own
   * channel when `<appId>@<version>` / `--app-version` names a pre-release.
   * Sent on `POST /api/drafts`; the server rejects an unknown/malformed name
   * (`INVALID_CHANNEL`) or a channel/version pairing it can't satisfy
   * (`NO_VERSION_ON_CHANNEL` / `VERSION_NOT_ON_CHANNEL`).
   */
  channel?: string;
  /**
   * From `--as <name>` (#428): alias of `--name`, matching the issue's
   * proposed `hola install remo --channel rc --as remo-beta` phrasing. If
   * both `--name` and `--as` are given, `--name` wins and a note is printed.
   */
  as?: string;
  /**
   * Restore-on-install (spec 007). `restoreFrom` is `--restore-from <id>` (a
   * candidate deployment id) or the literal string `latest`. `restore` is
   * `false` only when `--no-restore` was passed — the explicit-intent flag;
   * its ABSENCE (not passing any restore flag at all) is what FR-044 means by
   * "the non-interactive default is no restore", so `restore === false` and
   * `restoreFrom === undefined` are both "no restore", not two cases to
   * reconcile. `restoreList` is `--restore-list` (list and exit; installs
   * nothing). `carryEnv` is `true`/`false` only when `--carry-env`/
   * `--no-carry-env` was explicitly passed — `undefined` means "use the
   * candidate's own `carriesEnv` as the default" (contracts/cli.md).
   */
  restoreFrom?: string;
  restore?: boolean;
  restoreList?: boolean;
  carryEnv?: boolean;
  /** From `--ack <code>` (repeatable, or comma-separated) — mirrors `--grant`. */
  ack?: string | string[];
}

/** Parse repeated/comma-separated `--profile` flags into a deduped key list. */
export function parseProfiles(profile?: string | string[]): string[] | undefined {
  if (profile === undefined) return undefined;
  const raw = Array.isArray(profile) ? profile : [profile];
  const keys = raw.flatMap(p => String(p).split(',')).map(p => p.trim()).filter(Boolean);
  return [...new Set(keys)];
}

/**
 * Parse repeated/comma-separated `--grant` flags into a deduped contract-ref
 * list. Same shape as `parseProfiles`, but the values are `id@version` refs and
 * are NOT validated here: the server owns the contract table, so an unknown ref
 * simply doesn't match a declared grant and the install fails with a message
 * naming what the app actually asked for.
 */
export function parseGrants(grant?: string | string[]): string[] | undefined {
  if (grant === undefined) return undefined;
  const raw = Array.isArray(grant) ? grant : [grant];
  const refs = raw.flatMap(g => String(g).split(',')).map(g => g.trim()).filter(Boolean);
  return [...new Set(refs)];
}

/**
 * Parse repeated/comma-separated `--ack <code>` flags into a deduped
 * acknowledgement-code list — the exact same shape/parsing as `--grant`
 * (spec 007, contracts/cli.md), because a scripted install must acknowledge
 * each specific risk deliberately: it can never satisfy an acknowledgement it
 * did not name (SC-012).
 */
export function parseAcks(ack?: string | string[]): string[] | undefined {
  if (ack === undefined) return undefined;
  const raw = Array.isArray(ack) ? ack : [ack];
  const codes = raw.flatMap(a => String(a).split(',')).map(a => a.trim()).filter(Boolean);
  return [...new Set(codes)];
}

/** Every candidate across every lineage in a candidates response, flattened. */
function allCandidates(resp: ListRestoreCandidatesResponse): RestoreCandidate[] {
  return resp.lineages.flatMap(l => l.candidates);
}

/**
 * Render `--restore-list`'s output (contracts/cli.md): one line per
 * candidate, newest-first within its lineage, with a `!` warning line under
 * any candidate that carries one — each warning names the exact flag that
 * would satisfy it, so the operator's next command is on screen.
 */
function renderRestoreList(appId: string, resp: ListRestoreCandidatesResponse): string {
  const lines: string[] = [`Restore candidates for ${appId}:`, ''];
  for (const lineage of resp.lineages) {
    for (const c of lineage.candidates) {
      const captured = c.capturedAt ? new Date(c.capturedAt).toISOString().replace('T', ' ').slice(0, 16) : 'unknown';
      lines.push(
        `  ${c.deploymentId}   ${c.name}   ${c.host ?? c.subdomain ?? '(no host)'}   ${c.appVersion ? `v${c.appVersion}` : 'unknown version'}   env: ${c.carriesEnv ? 'yes' : 'no'}   ${captured}`,
      );
      for (const w of c.warnings) {
        if (w.code === 'env-not-carried') {
          lines.push(`                    ! configuration cannot be carried: ${w.keys.join(', ')}`);
          lines.push(`                      requires --ack restore-env-not-carried`);
        } else if (w.code === 'no-identity-record') {
          lines.push(`                    ! no install-identity record — described from the deployment record alone`);
        } else if (w.code === 'host-divergence') {
          lines.push(`                    ! host would change: ${w.from} → ${w.to}`);
        }
      }
      if (c.skew.kind === 'unknown') {
        lines.push(`                    ! version relationship unknown — requires --ack restore-version-unknown`);
      } else if (c.skew.kind === 'refused') {
        lines.push(`                    ! refused: ${c.skew.message}`);
      }
    }
  }
  const total = allCandidates(resp).length;
  lines.push('');
  lines.push(
    `${total} candidate${total === 1 ? '' : 's'} in ${resp.lineages.length} lineage${resp.lineages.length === 1 ? '' : 's'}.` +
      (resp.defaultCandidateId ? ` Default: ${resp.defaultCandidateId}` : resp.requiresExplicitChoice ? ' No default — pick one explicitly with --restore-from <id>.' : ''),
  );
  return lines.join('\n');
}

/**
 * Resolve `--restore-from <id|latest>` (+ `--carry-env`/`--ack`) into a
 * `RestoreChoice`, reading the candidates route to resolve `latest` and to
 * default `carryEnv` from the chosen candidate's own `carriesEnv`
 * (contracts/cli.md). `latest` REFUSES across two-or-more unrelated lineages
 * (FR-036) — "latest" is ambiguous across unrelated histories, so this must
 * fail rather than guess.
 */
async function resolveRestoreChoice(
  sdk: HolaSdk,
  appId: string,
  version: string,
  opts: InstallOptions,
): Promise<RestoreChoice> {
  const resp = (await sdk.restoreCandidates(appId, version, opts.source, opts.channel)) as ListRestoreCandidatesResponse;

  let candidateId: string;
  if (opts.restoreFrom === 'latest') {
    if (resp.requiresExplicitChoice || !resp.defaultCandidateId) {
      throw new DeployAbort(
        `--restore-from latest is ambiguous: ${resp.lineages.length} unrelated lineages match. ` +
          `Pick one explicitly with --restore-from <id>, or see them with --restore-list.`,
      );
    }
    candidateId = resp.defaultCandidateId;
  } else {
    candidateId = opts.restoreFrom!;
  }

  const candidate = allCandidates(resp).find(c => c.deploymentId === candidateId);
  const carryEnv = opts.carryEnv === false ? false : opts.carryEnv === true ? true : (candidate?.carriesEnv ?? false);
  const acknowledge = parseAcks(opts.ack);

  return { candidateId, carryEnv, ...(acknowledge?.length ? { acknowledge } : {}) };
}

/**
 * Heuristic: does this argument look like a full OCI reference (e.g.
 * `ghcr.io/acme/app:1.0`) rather than a catalog app id? True when it has a path
 * separator AND the first segment is a registry host (contains a `.` or `:`, or
 * is `localhost`). A bare `uptime-kuma` or a Slice-2 `sourceId/appId` is not a
 * ref, so those keep flowing through the catalog install path.
 */
export function looksLikeOciRef(arg: string): boolean {
  const slash = arg.indexOf('/');
  if (slash <= 0) return false;
  const host = arg.slice(0, slash);
  return host === 'localhost' || /[.:]/.test(host);
}

/**
 * Split an inline `<appId>@<version>` into its parts. An explicit `--app-version`
 * (passed via `flagVersion`) wins over the inline suffix. Splits on the last `@`
 * so app ids that themselves contain `@` are preserved. Returns `latest` when no
 * version is given anywhere — the server resolves that to the newest release.
 */
export function resolveAppAndVersion(
  appId: string,
  flagVersion?: string
): { appId: string; version: string } {
  const at = appId.lastIndexOf('@');
  const inlineVersion = at > 0 ? appId.slice(at + 1) : undefined;
  const bareAppId = at > 0 ? appId.slice(0, at) : appId;
  return { appId: bareAppId, version: flagVersion || inlineVersion || 'latest' };
}

/** Parse repeated `--set KEY=VALUE` into a map. */
function parseSet(set?: string | string[]): Record<string, string> {
  const items = set === undefined ? [] : Array.isArray(set) ? set : [set];
  const out: Record<string, string> = {};
  for (const item of items) {
    const eq = String(item).indexOf('=');
    if (eq <= 0) throw new Error(`Invalid --set '${item}' (expected KEY=VALUE)`);
    out[String(item).slice(0, eq).trim()] = String(item).slice(eq + 1);
  }
  return out;
}

/**
 * Install a catalog app by id: create a draft (the server seeds compose/env from
 * the catalog bundle), apply any `--set` env overrides, then validate → preflight
 * → finalize → deploy → watch. Uses only existing endpoints — the same flow the
 * web install wizard drives.
 */
export async function runInstall(
  rawAppId: string,
  opts: InstallOptions,
  injected?: { sdk?: HolaSdk }
): Promise<DeployResult | undefined> {
  const sdk = injected?.sdk ?? new HolaSdk();
  const out = (msg: string) => { if (!opts.json) console.log(msg); };

  // Install-by-ref: an OCI reference bypasses the catalog index. The server pulls
  // + validates the bundle (with the named credential for a private registry) and
  // seeds a draft, which we then finalize + deploy exactly like a catalog install.
  const isRef = looksLikeOciRef(rawAppId);
  const { appId, version } = isRef
    ? { appId: rawAppId, version: 'latest' }
    : resolveAppAndVersion(rawAppId, opts.appVersion);
  // `--as` (#428) is an alias of `--name`; `--name` wins when both are given.
  if (opts.name && opts.as) out('Note: --name overrides --as');
  const name = opts.name ?? opts.as ?? (isRef ? undefined : appId);

  // Restore-on-install (spec 007): `--restore-list` reads the candidates
  // route with NO draft created (research R6) and exits — it installs
  // nothing, so it runs before any of the create-a-draft work below.
  if (opts.restoreList) {
    if (isRef) {
      console.error('--restore-list needs a catalog app id, not an OCI reference.');
      process.exitCode = 1;
      return undefined;
    }
    try {
      const resp = (await sdk.restoreCandidates(appId, version, opts.source, opts.channel)) as ListRestoreCandidatesResponse;
      if (opts.json) console.log(JSON.stringify(resp, null, 2));
      else console.log(renderRestoreList(appId, resp));
      return undefined;
    } catch (err) {
      return reportDeployError(err);
    }
  }

  try {
    const overrides = parseSet(opts.set);

    // Restore-on-install (spec 007, FR-044): the non-interactive default is
    // NO restore — a candidate existing is not consent to use it. Only
    // `--restore-from` (never `--no-restore`, which is the same "no restore"
    // outcome stated explicitly) resolves an actual choice, and only on the
    // catalog path (R2) — install-by-ref refuses client-side here rather
    // than silently dropping it, matching the server's own fail-closed rule.
    let restoreFrom: RestoreChoice | undefined;
    if (opts.restoreFrom) {
      if (isRef) {
        console.error('Cannot restore on an install-by-ref install: no catalog index exists to judge the candidate\'s version against.');
        process.exitCode = 1;
        return undefined;
      }
      out(`Resolving restore source '${opts.restoreFrom}'…`);
      restoreFrom = await resolveRestoreChoice(sdk, appId, version, opts);
    }

    let draftId: string;
    if (isRef) {
      out(`Creating draft from OCI reference ${rawAppId}${opts.registryCred ? ` (credential: ${opts.registryCred})` : ''}`);
      draftId = (await sdk.installFromRef({ ociRef: rawAppId, credentialRef: opts.registryCred })).draftId;
    } else {
      const from = opts.source && opts.source !== 'hola' ? ` (source: ${opts.source})` : '';
      out(`Creating draft for ${appId}@${version} (from catalog${from})`);
      draftId = ((await sdk.drafts.create({ appId, version, source: opts.source, channel: opts.channel, ...(restoreFrom ? { restoreFrom } : {}) })) as CreateDraftResponse).draftId;
      if (restoreFrom) out(`Restoring from ${restoreFrom.candidateId} (carrying configuration: ${restoreFrom.carryEnv ? 'yes' : 'no'}).`);
    }

    // Merge `--set` overrides and auto-fill empty generate-recipe secrets onto
    // the catalog-seeded appEnv, then persist both in a single PATCH (only if
    // anything actually changed). We always re-fetch the draft — even with no
    // `--set` — because auto-fill must run for a plain `hola install <app>`
    // too (that's the actual non-interactive-install regression this fixes).
    const current = (await sdk.drafts.byId(draftId)) as GetDraftResponse;
    const appEnv: AppEnvVar[] = [...(current.appEnv ?? [])];
    let dirty = false;

    for (const [key, value] of Object.entries(overrides)) {
      const existing = appEnv.find(e => e.key === key);
      if (existing) existing.value = value;
      else appEnv.push({ key, value, isSecret: false });
      dirty = true;
    }

    if (!opts.noGenerateSecrets) {
      // A key the operator named in `--set` (even `--set SECRET=` to leave it
      // deliberately empty, e.g. an optional secret the app self-generates on
      // first boot) is an explicit choice — never auto-fill over it.
      const explicitKeys = new Set(Object.keys(overrides));
      for (const row of appEnv) {
        if (row.isSecret === true && row.value === '' && row.generate && !explicitKeys.has(row.key)) {
          row.value = generateSecretValue(row.generate);
          out(`Generated a value for ${row.key} (use --set ${row.key}=... to provide your own)`);
          dirty = true;
        }
      }
    }

    if (dirty) {
      await sdk.drafts.update(draftId, { appEnv });
    }

    // Validate typed values before spending a finalize round-trip on them —
    // clear `KEY: message` errors instead of a generic 422 from the server.
    const paramIssues = validateParams(appEnv).filter(i => i.severity === 'error');
    if (paramIssues.length) {
      for (const issue of paramIssues) {
        const key = issue.path?.startsWith('env.') ? issue.path.slice('env.'.length) : (issue.field ?? issue.code);
        console.error(`${key}: ${issue.message}`);
      }
      process.exitCode = 1;
      return undefined;
    }

    const result = await finalizeAndDeploy(sdk, draftId, { name, strict: opts.strict, noStream: opts.noStream, allowMultiple: opts.allowMultiple, profiles: parseProfiles(opts.profile), grants: parseGrants(opts.grant) }, out);

    if (opts.json) console.log(JSON.stringify(result, null, 2));
    else {
      out(`Done. ${appId} → job status: ${result.status}`);
      // #428: covers both an explicit --channel and a channel implied by a
      // pinned pre-release version, so an operator who typed only a version
      // learns what the deployment now follows.
      if (result.channel && result.channel !== STABLE_CHANNEL) out(`Following channel: ${result.channel}`);
    }
    if (result.status === 'failed' || result.status === 'error') process.exitCode = 1;
    await maybeNotifyUpdate(sdk, opts);
    return result;
  } catch (err) {
    return reportDeployError(err);
  }
}
