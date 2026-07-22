import { HolaSdk } from '@hola/sdk';
import type { CreateDraftResponse, GetDraftResponse, AppEnvVar } from '@hola/shared';
import { validateParams, generateSecretValue } from '@hola/shared/param-validate';

import { finalizeAndDeploy, reportDeployError, type DeployResult } from '../../lib/deploy-flow';
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
}

/** Parse repeated/comma-separated `--profile` flags into a deduped key list. */
export function parseProfiles(profile?: string | string[]): string[] | undefined {
  if (profile === undefined) return undefined;
  const raw = Array.isArray(profile) ? profile : [profile];
  const keys = raw.flatMap(p => String(p).split(',')).map(p => p.trim()).filter(Boolean);
  return [...new Set(keys)];
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
  const name = opts.name ?? (isRef ? undefined : appId);

  try {
    const overrides = parseSet(opts.set);

    let draftId: string;
    if (isRef) {
      out(`Creating draft from OCI reference ${rawAppId}${opts.registryCred ? ` (credential: ${opts.registryCred})` : ''}`);
      draftId = (await sdk.installFromRef({ ociRef: rawAppId, credentialRef: opts.registryCred })).draftId;
    } else {
      const from = opts.source && opts.source !== 'hola' ? ` (source: ${opts.source})` : '';
      out(`Creating draft for ${appId}@${version} (from catalog${from})`);
      draftId = ((await sdk.drafts.create({ appId, version, source: opts.source })) as CreateDraftResponse).draftId;
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

    const result = await finalizeAndDeploy(sdk, draftId, { name, strict: opts.strict, noStream: opts.noStream, allowMultiple: opts.allowMultiple, profiles: parseProfiles(opts.profile) }, out);

    if (opts.json) console.log(JSON.stringify(result, null, 2));
    else out(`Done. ${appId} → job status: ${result.status}`);
    if (result.status === 'failed' || result.status === 'error') process.exitCode = 1;
    await maybeNotifyUpdate(sdk, opts);
    return result;
  } catch (err) {
    return reportDeployError(err);
  }
}
