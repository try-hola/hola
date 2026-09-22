# Dependency advisories

How Hola audits its lockfile, how a finding is fixed, and — for the rare case a
finding *cannot* be fixed — where the reachability decision is written down.

## The command is `bun audit`, not `npm audit`

This is a Bun workspace with a single `bun.lock` and **no npm lockfile**, so
`npm audit` fails outright with `ENOLOCK` ("This command requires an existing
lockfile"). Generating a throwaway `package-lock.json` to satisfy it would audit
a resolution tree that is not the one we ship. Use:

```sh
bun install --frozen-lockfile   # audit what the lockfile actually pins
bun audit
```

`bun audit` exits non-zero when any advisory matches, at any severity.

## The rule

**`bun audit` reports zero advisories on `main`.** That is the whole policy, and
it is enforced by CI (`.github/workflows/audit.yml`). It is deliberately a hard
zero rather than a severity threshold: a standing list of "known, accepted"
findings is how a real one gets lost among them, and the cost of the rule is low
because almost every advisory here is fixed by a lockfile refresh.

## Fixing one

Two mechanisms, in this order of preference.

1. **The affected package is declared by a workspace.** Raise its floor in that
   package's `package.json` to the patched version and refresh the lock:

   ```sh
   bun update --cwd packages/<pkg> <name>
   ```

   Raising the declared floor (rather than only moving the lockfile) is the
   point: it records the security minimum where a human reads it, and stops a
   fresh resolve from picking a vulnerable version again.

2. **The affected package is transitive**, and its parent's range will not lift
   it (or pins it exactly — `@tailwindcss/postcss` pins `postcss` to an exact
   version, for instance). Add a **range** to the root `resolutions` block:

   ```jsonc
   "resolutions": {
     "postcss": "^8.5.28"   // floor = the patched version; patches still flow
   }
   ```

   Use a caret range, not an exact pin, so the entry expresses "never below the
   patched version" and does not itself become the thing that blocks a later
   patch. (Some pre-existing entries in that block are exact pins made for other
   reasons; those are not a precedent for security floors.)

Always re-run the full gate afterwards — `bun run typecheck && bun run lint &&
bun run typecheck && bun run test && bun run build`. A dependency bump's risk is
regression, not logic, so the suite *is* the review.

> **Wipe `node_modules` before you trust a test result during this work.**
> Bun does not prune a nested `node_modules/<pkg>` left behind by an earlier
> `bun update` experiment, and a stale nested copy silently shadows the hoisted
> one. Three web tests were observed failing against a tree in that state and
> passing from a clean install of the identical lockfile.

## When it cannot be fixed

If no patched version exists, or upgrading would mean a breaking change the
repository is not ready for, the advisory gets an **exception** — recorded in
the table below and passed to the audit explicitly:

```sh
bun audit --ignore=GHSA-xxxx-xxxx-xxxx
```

The ignore flag lives in `.github/workflows/audit.yml`, **not** in a config file
`bun audit` picks up on its own. That is deliberate: an exception should have to
appear in a reviewed diff, and should be visible to anyone running the audit
locally without it.

Every exception needs all four of: the reachability argument, a tracking issue, a
review date, and an owner. An exception past its review date is a bug.

| Advisory | Package | Reachability argument | Issue | Review by |
| --- | --- | --- | --- | --- |
| _(none)_ | | | | |

The table is empty, and that is the maintained state — this file carries no
permanent list of advisories to go stale. The historical record below is dated
and closed, not a live inventory.

## Historical record — F16 (security review, 2026-09)

At `d2f76fa`, `bun audit` reported **18 package/advisory entries across nine
packages — 17 distinct advisories (10 high, 7 moderate, 1 low)**;
`GHSA-82fw-gwwq-j7x9` matched twice, as `vitest` and as `@vitest/mocker`. All 17
were resolved by a lockfile refresh **within the existing declared semver
ranges** plus four transitive `resolutions` floors. Nothing needed a major bump
and nothing needed an exception. After: **zero**.

The reachability triage is recorded because the completion criteria asked for one
per advisory, and because it is the thing that decides urgency if a similar set
appears again — not because it justified inaction. Everything below was patched.

**Shipped to a browser — one package.** `react-router-dom` is a runtime
dependency of `packages/web`; `useNavigate` / `<Link>` appear in 10 source files.
The SPA mounts `BrowserRouter` under `createRoot` (`App.tsx`, `main.tsx`) — no
SSR, no RSC, no hydration — which is what splits the five advisories:

| Advisory | Sev | Mode | Reachable in Hola? |
| --- | --- | --- | --- |
| [GHSA-wrjc-x8rr-h8h6](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6) — open redirect via backslash in `<Link>`/`useNavigate` | moderate | client | **Yes** — the one advisory on the shipped path. Exploitability additionally requires an attacker-influenced navigation target. |
| [GHSA-chx6-hx7r-mcp5](https://github.com/advisories/GHSA-chx6-hx7r-mcp5) — DoS via inefficient route matching | high | client/server | Degraded: matching runs in the visitor's own tab, so the blast radius is that tab, not the host. |
| [GHSA-h8fp-f39c-q6mh](https://github.com/advisories/GHSA-h8fp-f39c-q6mh) — `RSCErrorHandler` missing protocol validation (XSS) | moderate | RSC | No — RSC mode is not used. |
| [GHSA-qwww-vcr4-c8h2](https://github.com/advisories/GHSA-qwww-vcr4-c8h2) — RSC-mode CSRF bypass | high | RSC | No — RSC mode is not used. |
| [GHSA-337j-9hxr-rhxg](https://github.com/advisories/GHSA-337j-9hxr-rhxg) — arbitrary constructor injection via `deserializeErrors()` | moderate | SSR hydration | No — nothing is server-rendered or hydrated. |

`react-router-dom@7.17.0` → **7.18.4** clears all five (four were fixed in
7.18.0, the RSC CSRF one in 7.18.2). The declared range was already `^7.17.0`,
which permits 7.18.4 — the lockfile was simply pinned to an older resolution.

**Build- and test-time only — eight packages.** None of these reach a browser or
the server runtime's request path; they run against this repository's own files,
on a developer's machine or a CI runner, and the "attacker-controlled input" each
advisory needs is a file we already control. They were patched anyway: leaving
them means the next audit opens with 13 entries and nobody can tell signal from
noise.

| Package | Advisories | Sev | Reached via | Resolved to |
| --- | --- | --- | --- | --- |
| `brace-expansion` | [GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg), [GHSA-rgw5-rvv9-x895](https://github.com/advisories/GHSA-rgw5-rvv9-x895), [GHSA-3jxr-9vmj-r5cp](https://github.com/advisories/GHSA-3jxr-9vmj-r5cp) | 3 high | `eslint`, `typescript-eslint` → `minimatch` | 5.0.12 (resolution) |
| `nanoid` | [GHSA-28wg-ghj8-5hjv](https://github.com/advisories/GHSA-28wg-ghj8-5hjv), [GHSA-2v37-7h3g-55p8](https://github.com/advisories/GHSA-2v37-7h3g-55p8) | 2 high | `postcss` | 3.3.19 (follows `postcss`) |
| `postcss` | [GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849), [GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp) | 1 high, 1 moderate | web devDep; `vite`, `autoprefixer`, `@tailwindcss/postcss` | 8.5.28 (floor + resolution) |
| `browserslist` | [GHSA-c83g-rgw3-j3cx](https://github.com/advisories/GHSA-c83g-rgw3-j3cx), [GHSA-73wf-gq98-2v4g](https://github.com/advisories/GHSA-73wf-gq98-2v4g) | 2 high | `autoprefixer`, `eslint-plugin-react-hooks` | 4.29.0 (resolution) |
| `vitest` + `@vitest/mocker` | [GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9) (one advisory, two entries) | moderate | web + cli devDep | 4.1.11 (floor) |
| `baseline-browser-mapping` | [GHSA-w5vr-8v7q-w6rv](https://github.com/advisories/GHSA-w5vr-8v7q-w6rv) | moderate | `browserslist` | 2.11.25 (follows `browserslist`) |
| `@babel/core` | [GHSA-4x5r-pxfx-6jf8](https://github.com/advisories/GHSA-4x5r-pxfx-6jf8) | low | `eslint-plugin-react-hooks` | 7.29.7 (resolution) |

`nanoid`'s two `high` entries are the clearest illustration of why a raw audit
count is not a risk measure: it is not a direct dependency of any package, is
imported nowhere in the source tree, and reaches the lockfile only as PostCSS's
id generator at CSS build time.

**Nothing shipped in the server runtime image was affected.** The image does
install the full workspace (including devDependencies) — tracked separately as
#551 — so trimming it would shrink this surface further, but no advisory in this
set had a server-runtime reachability path.

**Not covered by F16:** container-image scanning (the server image's OS and base
layers, not the npm tree) — #552.
