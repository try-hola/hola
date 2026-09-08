# CLI and SDK contract

## SDK (`@hola/sdk`)

- `HolaApiError { status, code?, details?, requestId? }` thrown for non-2xx responses whose body is `{ error: {...} }`; `message` = server message. Non-JSON bodies keep the legacy `HTTP <status> <text>` message (still a `HolaApiError`).
- `sdk.settings.get(): GetSettingsResponse`, `sdk.settings.update(PatchSettingsRequest): PatchSettingsResponse`.

## `hola channel <deploymentId> [channel] [--json]`

```
$ hola channel dep_1
Follows: stable
Running: 1.2.0 (stable build)

$ hola channel dep_1 beta
Now follows: beta
$ hola channel dep_1 stable
Now follows: stable
Stays on 1.3.0-beta.1 until a stable release at or above it is published.
```

- Warnings from the PATCH are printed one per line prefixed `Warning:`.
- Validation failures print `Failed: <server message>`, exit 1.

## `hola settings prerelease [on|off] [--json]`

```
$ hola settings prerelease
Show pre-release channels: off
$ hola settings prerelease on
Show pre-release channels: on
```

- Any other value → `Usage: hola settings prerelease [on|off]`, exit 1.

## `hola install` conflict rendering

```
Failed: 'gitea' is already installed as 'gitea' and follows 'stable'. This app is single-instance.
Hint: 'gitea' (dep_1) already follows stable. Switch it with 'hola channel dep_1 <channel>',
      install a separate copy on another published channel with '--channel <name>',
      or force a second copy with '--allow-multiple --name gitea-2'.
```

The `--channel` clause appears only when `details.channelPublished` is true.

## `hola deployments`

- Unchanged: `<name> [<channel>]` for non-stable followed channels.
