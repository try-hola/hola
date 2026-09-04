# Bundle manifest contract (what the server reads)

The catalog repository owns the JSON schema; this records what **this server build** accepts and how it degrades. Anything malformed is dropped with a warning, never fatal (ADR 0003).

## `backup` — plural participations (new) and the singular form (kept)

```jsonc
// singular — still valid, read as one participation named "default"
"accepts": ["backup@1"],
"backup": {
  "preHook":  { "service": "db", "command": ["sh", "-c", "pg_dump -U app app > /backups/app.sql"] },
  "postHook": { "service": "db", "command": ["rm", "-f", "/backups/app.sql"] }
}

// plural — one entry per thing that needs quiescing
"accepts": ["backup@1"],
"backup": [
  { "id": "app-db",
    "preHook":  { "service": "postiz-postgres",   "command": ["sh", "-c", "pg_dump … > /backups/postiz.sql"] },
    "postHook": { "service": "postiz-postgres",   "command": ["rm", "-f", "/backups/postiz.sql"] } },
  { "id": "temporal-db",
    "preHook":  { "service": "temporal-postgres", "command": ["sh", "-c", "pg_dump … > /backups/temporal.sql"] },
    "postHook": { "service": "temporal-postgres", "command": ["rm", "-f", "/backups/temporal.sql"] } }
]
```

Rules:
- `id`: non-empty string, unique within the app; first wins, duplicates dropped with a warning; required in the plural form.
- Each entry needs at least one well-formed hook; hook shape unchanged (`service` string, `command` exec-form argv).
- Execution: pre-hooks in declaration order before the capture; post-hooks in the same order after. One failing pre-hook fails the prepare; the post-hooks of every participation already started still run.
- Coverage: the pre-hook's `service` is what a participation quiesces. A database service (by image family) with no pre-hook naming it makes the app **partially covered** in the dashboard.

## `provides: ["container-logs@1"]` (new contract)

```jsonc
"provides": ["container-logs@1"]
```

- The operator must consent at install (wizard checkbox or `hola install --grant container-logs@1`); without consent the install is refused.
- On consent the platform adds a `hola-docker-proxy` sidecar to the app's compose and sets `DOCKER_HOST=tcp://hola-docker-proxy:2375` on every app service. The bundle **must not** mount the docker socket or the docker log directory itself (the validator rejects it) and **must not** declare a service named `hola-docker-proxy`.
- The proxy permits container list, redacted inspect (no env, no host config, no mounts), logs and events only.
- Every app container carries `sh.hola.app`, `sh.hola.deployment`, `sh.hola.name` labels for grouping.
- `accepts: ["container-logs@1"]` is meaningless (participation is implicit) and is dropped with a warning.
- One provider per host: a second app providing `container-logs@1` is refused at install while the first exists.

## Unchanged

`auth`, `push`, `security`, `profiles`, `consumes: app-registry`, `provides: ["backup@1"]`.
