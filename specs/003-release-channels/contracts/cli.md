# CLI contract changes: Release Channels

Package: `packages/cli` (`sade`). `--version` is reserved by sade, so all version flags stay
`--app-version`.

## `hola install <appId>`

New options:

| Flag | Meaning |
|---|---|
| `--channel <name>` | Follow this release channel. `latest` resolves to the newest version eligible on it. Default: `stable`, or the pinned version's channel when `<appId>@<version>` / `--app-version` names a version on another channel. |
| `--as <name>` | Alias of `--name`. If both are given, `--name` wins and a one-line note is printed. |

Behaviour:
- `channel` is sent on `POST /api/drafts` (not on deployment create).
- Success output appends `Following channel: <c>` whenever the created deployment's channel
  is not `stable` — which covers both an explicit `--channel` and a channel implied by a
  pinned pre-release version, so an operator who typed only a version learns what the
  deployment now follows. `--json` output includes `channel`.
- Errors from the server surface through the existing `reportDeployError`:
  - `NO_VERSION_ON_CHANNEL` → message as-is, exit 1;
  - `VERSION_NOT_ON_CHANNEL` → message as-is, exit 1;
  - single-instance `409` → message as-is (it now names `--channel`), exit 1;
  - subdomain conflict → existing hint ("pick a distinct --name"), exit 1.

Examples (also added to `.example(...)`):
```
hola install remo --channel rc --as remo-beta
hola install remo@0.11.0-rc.1 --name remo-beta     # channel implied: rc
```

## `hola upgrade <deploymentId>`

No new flags. Default target is the server's channel-filtered `latestVersion`. An explicit
`--app-version` outside the channel returns `VERSION_NOT_ON_CHANNEL` (printed verbatim,
exit 1).

## `hola deployments`

Table rows append ` [<channel>]` after the name when `channel !== 'stable'`. `--json` is the
raw response (already carries `channel`).

## `hola catalog [query]`

Rows append `  (channels: <non-stable list>)` when the app has any non-stable channel.
`--json` raw.

## README

`packages/cli/README.md` "Catalog & install" paragraph documents `--channel`, `--as`, the
implied-channel rule, and that a channel copy starts empty (tests boot/route/auth, not data
migration) with a pointer to the clone follow-up issue.

## Tests (`packages/cli/src/__tests__`)

- `install.test.ts`: `--channel` reaches `drafts.create`; `--as` maps to `name`; both given
  → `--name` wins + note; "Following channel" printed for rc and for an implied channel;
  not printed for plain stable.
- `deployments.test.ts`: `[rc]` suffix rendered for a non-stable row, absent for stable.
- `catalog.test.ts`: `(channels: rc)` suffix rendered when `channels` includes `rc`.
