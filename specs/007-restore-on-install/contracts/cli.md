# Contract: CLI surface

**Feature**: `specs/007-restore-on-install` · **Package**: `packages/cli`

Not a capability contract — these are flags on an existing command. See
[api.md](./api.md) for why the distinction matters to FR-047.

## Flags on `hola install`

| Flag | Effect |
|---|---|
| `--restore-from <deploymentId>` | Restore from that deployment. |
| `--restore-from latest` | Restore from the newest candidate. Refuses when two or more lineages match (FR-036) — "latest" is ambiguous across unrelated histories. |
| `--no-restore` | Explicitly decline. Same behaviour as omitting every flag; exists so a script states intent. |
| `--restore-list` | List candidates and exit. Installs nothing. |
| `--carry-env` / `--no-carry-env` | Carry the candidate's configuration. Default **on** when the candidate has an environment record — carrying is what makes the restored data readable (spec US2), so the safe default is the one that preserves it. `--no-carry-env` requires `--ack restore-env-not-carried`. |
| `--ack <code>` | Supply an acknowledgement code. Repeatable or comma-separated, parsed exactly like `--grant` (`install.ts:82-93`). |

## The default is the contract

**With no restore flag, no restore happens** (FR-044).

A candidate existing is not consent to use it. Silence must never overwrite an
operator's install decision with a guess — an unattended install that restored a
stale copy of production because a candidate happened to be present would be
unrecoverable by the time anyone noticed.

This is why `--ack` exists rather than a `--yes`-style blanket. A scripted install
acknowledges each specific risk deliberately or fails closed (FR-046); it can
never satisfy an acknowledgement it did not name (SC-012).

## `--restore-list` output

```
$ hola install mealie --restore-list
Restore candidates for mealie:

  mealie-3f2a9c11   Recipes        recipes.example.com   v3.20.1   env: yes   2026-09-19 22:14
  mealie-8b41d0e7   Recipes (old)  old.example.com       v3.18.0   env: no    2026-09-02 09:41
                    ! configuration cannot be carried: POSTGRES_PASSWORD
                      requires --ack restore-env-not-carried

2 candidates in 1 lineage. Default: mealie-3f2a9c11
```

Reads the candidates route ([api.md](./api.md) §1) with no draft created — which
is why that route exists as a route (research R6). Every warning line names the
flag that would satisfy it, so the operator's next command is on screen.

## Refusals

Hints are built from structured `details`, **never** from the server's message.
`deploy-flow.ts:137-155` already establishes both the rule and the reason: the
server's message is deliberately surface-neutral and contains none of the CLI's
flag names, so a message-derived hint would be wrong in a way no server test
catches.

```
$ hola install mealie --restore-from mealie-8b41d0e7
Error: this backup was taken on a newer version of mealie than the one
being installed.

  captured on   v3.22.0
  installing    v3.20.1

Install v3.22.0 instead, or pick a different candidate:
  hola install mealie --version 3.22.0 --restore-from mealie-8b41d0e7
  hola install mealie --restore-list
```

Mapping from `details.code` to the hint, one row per code
([data-model.md](../data-model.md) §4):

| `details.code` | Hint built from |
|---|---|
| `RESTORE_SOURCE_NEWER` | `candidateVersion`, `targetVersion` → suggest `--version <candidateVersion>` |
| `RESTORE_UPGRADE_PATH` | `suggestedVersion` → install that, restore there, then promote |
| `RESTORE_ENV_REQUIRED` | `missingKeys[]` → name them; this app cannot restore without them |
| `RESTORE_ACK_REQUIRED` | `required[]` → the exact `--ack <code>` to add |
| `RESTORE_CANDIDATE_GONE` / `_BUSY` | suggest `--restore-list` to re-read the current set |
| `RESTORE_NOT_SUPPORTED` | install-by-ref cannot restore; use the catalog path |
| `RESTORE_NOT_ACCEPTED` | this app has not declared it can be restored; install fresh |

## Unchanged

`hola install`'s existing flags, `--grant` parsing, and the `ALREADY_INSTALLED`
branch at `deploy-flow.ts:145-155` all behave exactly as they do today. There is
no new command and no new subcommand — restore is an option on install, because
install is the only moment it is safe (spec §Executive Summary).
