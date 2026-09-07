# Dashboard contract

## Backups page (`pages/Backups.tsx` → `components/BackupCoverage.tsx`, `utils/backup-coverage.ts`)

- `Coverage` gains `partial`. `COVERAGE_META.partial`: label **"Partially covered"**, warn colours, title "Some of this app's databases have no pre-backup hook, so they may be copied mid-write. `{targeted} of {recognised}` quiesced."
- `coverageRows` derives each acceptor's state from `participant.coverage?.state`, falling back to `hooks ? 'quiesced' : 'as-is'` only when `coverage` is absent.
- The badge for `partial` shows the counts inline: `Partially covered · 1 of 2`.
- Header count: `covered` counts `quiesced` and `as-is` only. Wording: `{covered} of {rows.length} installed apps covered`, and when any row is partial, an extra muted `{n} partially`.
- `ProviderPanel`: when `rollup.providerConflict` is true, a warning row: "More than one app provides backups. Hola expects one provider per contract; uninstall one of them." Header stays singular.
- Rows for an **implicit** contract are never rendered with the uncovered treatment; the Backups page only renders `backup@1`, so no change is needed there beyond the guard in `coverageRows` (an implicit rollup passed in yields no `uncovered` rows).

## Deployment detail (`pages/DeploymentDetail.tsx` → `AppBackupCoverage`)

- State from `contracts.coverage?.['backup@1']?.state`, fallback as above.
- For `partial`: the description names the unquiesced services: "`temporal-postgres` has no pre-backup hook." (services = `databases` minus participations' services).
- Grants: the existing facts list shows each granted contract by its grant label; `container-logs@1` renders "Reads every container's logs".

## Install wizard (`pages/InstallWizard.tsx`)

- No structural change: `providerGrantsFor(provides)` already renders one checkbox per grant; the new `container-logs` grant appears with its own label/risk text.
- New rejection surfaced: a `409 PROVIDER_EXISTS` from create shows the server message in the existing error area with the existing-provider name linked when `existing.id` is present.

## CLI (`packages/cli`)

- `hola install --grant container-logs@1` works as today for any ref.
- A `409 PROVIDER_EXISTS` prints the server message verbatim and exits non-zero (existing conflict path).
