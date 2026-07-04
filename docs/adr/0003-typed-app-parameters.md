# ADR 0003: Typed app-install parameters

- **Status:** Accepted (July 2026)
- **Context:** App-install parameter model has been plain-text `{ key, value, isSecret, description? }`
  since the install wizard shipped. This ADR covers PR 1 of an 8-PR rollout (shared types + validator);
  server/web/CLI integration and the apps-repo migration follow in later PRs.

## Context

Hola's install wizard renders every app-declared env var as a plain text box, regardless of what it
actually holds. Catalog manifests already *implicitly* type their vars — `DOMAIN` is a URL,
`SIGNUPS_ALLOWED` is a boolean, `PUID`/`PGID` are small integers, `TZ` is an IANA timezone,
`JWT_SECRET` wants 32 random bytes of hex — but none of that is machine-readable, so the wizard
can't render a toggle, a number spinner, a timezone picker, or a "generate" wand, and nothing
validates that what the operator typed actually fits.

Worse, there is a live bug in the current all-or-nothing model: `MISSING_SECRET_VALUE` treats *any*
empty secret as an error (`validation.ts:355-383`), and `finalize` enforces it (`draft.ts:660-671`).
Some upstream images treat an empty password as "auto-generate on first boot" (Webtop `PASSWORD`,
Paperless `PAPERLESS_ADMIN_PASSWORD`), so those installs are unconditionally blocked, and
non-interactive `hola install <app>` fails for any app with a secret the manifest intends to leave
optional. There is no way for a manifest to say "this secret is optional."

## Decision

### Option A: extend `defaultEnv` in place, additively

Two shapes were on the table: (1) a parallel `paramSpec` schema alongside `defaultEnv`, or
(2) extending each `AppEnvVar` row in `defaultEnv` with optional typed fields. We chose (2).

The deciding factor is the server's own catalog manifest coercion
(`services/core/catalog.ts:389-444`), which narrows each incoming manifest field to a known shape and
silently drops anything it doesn't recognize. That means:

- An **old server** reading a **new manifest** (typed fields present) just drops the new fields and
  falls back to the current plain-text behavior — no crash, no validation error, no migration.
- A **new server** reading an **old manifest** (no typed fields) sees every new field as `undefined`,
  which this ADR's tri-state `required` semantics (below) define to mean "behave exactly as today."

Every new field on `AppEnvVar` is optional, and no existing field's meaning changes. This is what
makes the whole feature line up as a pure additive extension rather than a schema version bump: old
manifests, old drafts, and old server builds all keep working, and the two repos (hola, try-hola/apps)
don't have to release in lockstep.

A parallel `paramSpec` object was rejected because it would require keeping two structures in sync
per key (easy to let drift) and gives coercion nothing extra — the per-key row is already the natural
unit both the wizard and the validator operate on.

### `isSecret` and `type` are orthogonal

`isSecret` controls *masking and generation* (eye icon, wand, redaction in API responses); `type`
controls *what a legal value looks like*. A secret can be typed (`isSecret: true, type: 'string',
minLength: 32, generate: { kind: 'hex' }` for a token) or untyped (opaque credential, no shape to
check). Collapsing them into one axis would force every secret into a single "credential" type and
lose the ability to say "this secret must look like N hex chars."

### The `required` tri-state

`required` is `true | false | undefined`, not a plain boolean, because collapsing it loses
information needed for back-compat:

- `undefined` (unset) — **legacy rule**: `isSecret` implies required, everything else is optional.
  This is exactly today's behavior, so every manifest written before this field existed keeps
  behaving identically.
- `true` — empty is always an error, secret or not. Lets a manifest mark a *non-secret* field
  mandatory (e.g. a hostname), which the legacy rule couldn't express at all.
- `false` — empty is fine, **even for a secret**. This is the fix for the optional-secret bug above:
  a manifest can now say "leave `PAPERLESS_ADMIN_PASSWORD` blank and the app will generate its own."

A plain `required?: boolean` (defaulting `false`) would have silently flipped every existing secret
to optional the moment the field was introduced — exactly backwards. The tri-state is what lets
"unset" mean "old behavior" rather than forcing every manifest author to explicitly restate the
legacy rule.

### Seed-time platform-token prefill

Drafts already carry unresolved `${HOLA_APP_HOST}` / `${HOLA_BASE_DOMAIN}` tokens in `defaultEnv`
values that only get substituted at deploy time (`deployment.ts:1107-1111`), never at draft-seed or
PATCH time. `validateParamValue` treats a value that's *exactly* one of `KNOWN_PLATFORM_TOKENS`
(`compose-validate.ts`) as "not yet a real value" and skips type checks entirely — otherwise a
manifest declaring `DOMAIN` as `type: 'url'` would fail its own seeded default (`${HOLA_APP_HOST}` is
not a URL) before the server ever gets a chance to resolve it. This also means later PRs are free to
prefill those tokens into typed fields at seed time without the validator fighting them.

### Unknown future `type` degrades to untyped + warning

`type` is a closed union today (`string | integer | port | boolean | enum | url | email | timezone`),
but the catalog is a separate repo on its own release cadence, so a manifest may eventually declare a
`type` this server build has never heard of. The chosen forward-compat rule (implemented in the
server's catalog coercion, PR 2): an unrecognized `type` string degrades to untyped (dropped, so the
field renders and validates as plain `'string'`) plus a logged warning — never a hard failure at
catalog-load or install time. `validateParamSpec` (this module) is the *other* half of that story: it
flags an unknown `type` as `PARAM_INVALID_SPEC`, but that check is for the apps-repo's own manifest CI
(catching an author's typo before publish), not for runtime enforcement — a stale server encountering
a legitimately newer vocabulary word should never brick an install.

## Consequences

- `packages/shared/src/index.ts`'s `AppEnvVar` gains ~15 optional fields and two new exported types
  (`ParamType`, `ParamGenerate`, `ParamEnumOption`); `SystemEnvVar` (a type alias) inherits the fields
  structurally, but nothing in the system produces typed system-env-var specs — they stay
  conceptually untyped free text.
- A new pure module, `packages/shared/src/param-validate.ts`, is the single source of truth for what
  a typed value/spec means: `validateParamValue`, `validateParams`, `validateParamSpec`,
  `generateSecretValue`. Server, web, and CLI all import it rather than re-implementing per-type
  rules three times.
- Fourteen new `ValidationIssueCode` values (`PARAM_*`) are added to the existing open union;
  existing codes are untouched.
- The server's ad hoc `MISSING_SECRET_VALUE` check on empty secrets becomes redundant with
  `validateParams`'s `PARAM_REQUIRED_MISSING` (same tri-state, `undefined` branch reproduces the old
  rule exactly) — PR 2 replaces the inline check with a call into this module so the `required:
  false` escape hatch actually takes effect instead of being overridden.
- No behavior changes ship in this PR: the new fields aren't read by the server, web, or CLI yet, and
  no manifest in `try-hola/apps` sets them yet. This PR is purely the shared contract; PRs 2-8 wire it
  up end to end.
