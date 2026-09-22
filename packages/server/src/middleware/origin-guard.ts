/**
 * Cross-site request forgery defence for the ONE credential Hola has that a
 * browser attaches ambiently: the admin-key session cookie (F04).
 *
 * ## The exposure
 *
 * Hola installs apps as subdomains of one registrable domain — the dashboard at
 * `HOLA_DOMAIN`, every app at `<app>.<HOLA_BASE_DOMAIN>`. `app.example.com` and
 * `hola.example.com` are therefore **same-site but not same-origin**, and
 * `SameSite=Strict` is a same-*site* control: it does not stop a page served by
 * an installed app from making a request to the dashboard with the operator's
 * session cookie attached. A `text/plain` POST is a CORS-simple request, so no
 * preflight is issued and no CORS response header can prevent the mutation from
 * executing — the browser only withholds the *response*. That is enough to stop
 * an app, delete a deployment, or rewrite settings.
 *
 * ## The rule
 *
 * A **mutating** request whose credential is the **session cookie** must prove
 * it was initiated by the dashboard itself:
 *
 * 1. `Sec-Fetch-Site`, if the browser sent it, must be `same-origin` or `none`.
 * 2. `Origin` must be present, and its host must be a trusted dashboard host.
 * 3. Its `Content-Type`, if it has one, must be a type the API actually speaks.
 *
 * Every other caller is untouched, and that is the point. The CLI, the SDK and
 * the contract-broker calls from catalog containers authenticate with
 * `Authorization: Bearer` or `X-API-Key` — headers nothing attaches on the
 * caller's behalf, so setting one means holding the key — so they are not
 * forgeable and are not asked for an `Origin` they have no reason to send. A
 * blanket "mutations require a trusted Origin" rule would have broken all of
 * them. The rule keys on HOW the request authenticated, never on the fact that
 * it mutates.
 *
 * Reads are out of scope: SSE authenticates by cookie and is a `GET`, and a
 * forged read is not readable cross-origin anyway.
 *
 * ## What this does NOT do
 *
 * There is no CSRF token. A double-submit token would be a second copy of a
 * check the browser already makes unforgeably (a page cannot lie about
 * `Origin`, and scripts cannot set it), and it would not address the real
 * weakness underneath — that the cookie's value IS the reusable admin key.
 * Opaque server-side sessions are the fix for that, tracked in #525.
 */

import { getLogger } from '../lib/logger';
import { resolveCredential, type CredentialSource } from './auth';

/** Methods that can change state, and therefore need proof of intent. */
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Media types a mutating Hola request may carry.
 *
 * `application/json` is what the SDK, the web client and every documented
 * `curl` example send. `multipart/form-data` is required by exactly one route —
 * the draft file upload (`POST /api/drafts/:id/uploads`) — and is kept because
 * that route would otherwise break; note that multipart is itself a CORS-simple
 * type, so this list is not what stops forgery. The origin check is. Rejecting
 * `text/plain` and `application/x-www-form-urlencoded` closes the trivially
 * scriptable shapes (a plain `<form>` post, `fetch` with no headers set) as a
 * second line, and returns a diagnosable 415 rather than silently parsing a
 * body whose declared type says it is not JSON.
 */
const ACCEPTED_MUTATION_MEDIA_TYPES = new Set(['application/json', 'multipart/form-data']);

/** The header name that carries the browser's own account of who initiated. */
const SEC_FETCH_SITE = 'sec-fetch-site';

/** `Sec-Fetch-Site` values compatible with a dashboard-initiated request. */
const SAME_ORIGIN_FETCH_SITES = new Set(['same-origin', 'none']);

export type MutationDecision =
  | 'allow'
  /** An `Origin`/`Sec-Fetch-Site` that is not this dashboard. */
  | 'untrusted-origin'
  /** A cookie-authenticated mutation with no `Origin` at all. */
  | 'missing-origin'
  /** A body whose declared media type the API does not accept. */
  | 'unsupported-media-type';

/**
 * Everything the decision depends on, as data.
 *
 * Taken as a record rather than read off a `Request` so the rule can be
 * exercised as a truth table — the combination that matters (cookie + sibling
 * origin + `same-site` + `text/plain`) is one row, and so is every legitimate
 * caller it must not catch.
 */
export interface MutationIntent {
  method: string;
  /** The credential in force, from `resolveCredential`. */
  credentialSource: CredentialSource | null;
  origin: string | null;
  secFetchSite: string | null;
  /**
   * The `Host` the request was addressed to. Not spoofable by a browser page:
   * `Host` is a forbidden header for `fetch`/`XMLHttpRequest`, and it is set
   * from the URL the request actually went to — which, for an attack on the
   * dashboard, must be the dashboard.
   */
  host: string | null;
  contentType: string | null;
  /** Hosts trusted in addition to `host`, from `configuredTrustedHosts()`. */
  trustedHosts: string[];
}

/** Normalise a configured origin or host to a bare `host` (may include a port). */
function toHost(value: string): string | null {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  if (trimmed.includes('://')) {
    try {
      return new URL(trimmed).host || null;
    } catch {
      return null;
    }
  }
  return trimmed;
}

/**
 * Dashboard hosts an operator has configured.
 *
 * `HOLA_DOMAIN` is the dashboard's own external host — the compose stack passes
 * it to the server container and `hola init` always sets it, and it is already
 * the value Traefik routes the UI by (`coreRoutesFromEnv`), so it is the one
 * fact about "where the dashboard is" that cannot be out of step with reality.
 * `HOLA_TRUSTED_ORIGINS` (comma-separated origins or bare hosts) is the escape
 * hatch for an install reached at a second name, or fronted by a proxy that
 * rewrites `Host`.
 *
 * Deliberately NOT a hardcoded list, and deliberately not fatal when empty: an
 * empty result does not disable the rule. The request's own `Host` is always
 * trusted alongside these (see `originIsTrusted`), and comparing `Origin`
 * against the `Host` it was sent to IS the same-origin check — a sibling app's
 * origin never equals the dashboard's host. So an install with `HOLA_DOMAIN`
 * unset is still closed against the attack; configuring it only pins the
 * decision to a named host instead of an inferred one.
 */
export function configuredTrustedHosts(env: Record<string, string | undefined> = process.env): string[] {
  const hosts: string[] = [];
  for (const raw of (env.HOLA_TRUSTED_ORIGINS ?? '').split(',')) {
    const host = toHost(raw);
    if (host) hosts.push(host);
  }
  const domain = toHost(env.HOLA_DOMAIN ?? '');
  if (domain) hosts.push(domain);
  return hosts;
}

/**
 * Whether `origin` names this dashboard.
 *
 * Both `host` (hostname:port) and `hostname` are compared against each trusted
 * entry so that a configured bare domain matches an origin on the default port
 * and a configured `host:port` matches exactly.
 */
function originIsTrusted(origin: string, host: string | null, trustedHosts: string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    // Includes the literal `Origin: null` a sandboxed iframe or `data:` document
    // sends. Not a trusted dashboard, and not parseable into one.
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  const candidates = [...trustedHosts, ...(host ? [host] : [])];
  return candidates.some((trusted) => parsed.host === trusted || parsed.hostname === trusted);
}

/** The bare media type of a `Content-Type`, lowercased, parameters dropped. */
function mediaType(contentType: string): string {
  return contentType.split(';')[0]!.trim().toLowerCase();
}

/**
 * The decision, from the intent alone.
 *
 * Order is deliberate: the origin checks come before the media-type check so
 * that the finding's own reproduction is refused as what it is — a cross-origin
 * mutation, 403 — rather than as a content-type quibble the attacker could fix
 * by sending `application/json`.
 */
export function judgeMutation(intent: MutationIntent): MutationDecision {
  if (!MUTATING_METHODS.has(intent.method.toUpperCase())) return 'allow';

  // Only the ambient credential is forgeable. A header or query credential had
  // to be held by the caller, so its request carries its own proof of intent.
  if (intent.credentialSource !== 'cookie') return 'allow';

  const site = intent.secFetchSite?.trim().toLowerCase();
  if (site && !SAME_ORIGIN_FETCH_SITES.has(site)) return 'untrusted-origin';

  // Every browser that can reach this code sends `Origin` on a mutating
  // request, same-origin included, so its absence means the caller is not the
  // dashboard. Fail closed: a script driving the API with a copied cookie jar
  // should present the key as a header, which is the supported path and is
  // exempt from this rule entirely.
  if (!intent.origin) return 'missing-origin';
  if (!originIsTrusted(intent.origin, intent.host, intent.trustedHosts)) return 'untrusted-origin';

  if (intent.contentType && !ACCEPTED_MUTATION_MEDIA_TYPES.has(mediaType(intent.contentType))) {
    return 'unsupported-media-type';
  }

  return 'allow';
}

/** The host part of a URL, or null if it will not parse. */
function hostOfUrl(url: string): string | null {
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
}

/** Read the intent off a real request. */
export function mutationIntentOf(
  req: Request,
  env: Record<string, string | undefined> = process.env,
): MutationIntent {
  return {
    method: req.method,
    credentialSource: resolveCredential(req)?.source ?? null,
    origin: req.headers.get('origin'),
    secFetchSite: req.headers.get(SEC_FETCH_SITE),
    // `Host`, or the request URL's host when the header is absent. Under
    // `Bun.serve` these are the same value — the runtime builds `req.url` from
    // the `Host` header — but a directly-constructed `Request` carries the host
    // only in its URL, so reading both keeps the in-process harness and the
    // wire identical.
    host: req.headers.get('host') ?? hostOfUrl(req.url),
    contentType: req.headers.get('content-type'),
    trustedHosts: configuredTrustedHosts(env),
  };
}

/** The HTTP shape of a refusal, matching the error envelope every route uses. */
function refuse(decision: Exclude<MutationDecision, 'allow'>): Response {
  const { status, code, message } =
    decision === 'unsupported-media-type'
      ? {
          status: 415,
          code: 'UNSUPPORTED_MEDIA_TYPE',
          message: 'Mutating requests must send application/json (or multipart/form-data for uploads).',
        }
      : decision === 'missing-origin'
        ? {
            status: 403,
            code: 'MISSING_ORIGIN',
            message:
              'A session-cookie request that changes state must send an Origin header. Use Authorization: Bearer or X-API-Key for programmatic access.',
          }
        : {
            status: 403,
            code: 'CROSS_ORIGIN_MUTATION',
            message: 'This request did not come from the Hola dashboard and was refused.',
          };

  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

/**
 * Middleware. Runs BEFORE authentication, for two reasons: the checks are
 * header-only and cheap, and the rule must hold on the public mutating routes
 * too — `POST /api/auth/logout` carries the cookie and is otherwise a free
 * cross-origin session teardown.
 */
export function createOriginGuardMiddleware() {
  const logger = getLogger().child({ service: 'OriginGuard' });

  return async function originGuard(req: Request, next: () => Promise<Response>): Promise<Response> {
    const intent = mutationIntentOf(req);
    const decision = judgeMutation(intent);
    if (decision === 'allow') return next();

    logger.warn('Refused a cookie-authenticated mutation', {
      path: new URL(req.url).pathname,
      method: req.method,
      decision,
      origin: intent.origin,
      secFetchSite: intent.secFetchSite,
      host: intent.host,
      contentType: intent.contentType,
    });

    return refuse(decision);
  };
}
