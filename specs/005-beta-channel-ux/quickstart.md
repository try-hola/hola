# Quickstart: validating Beta Channel Support for Catalog Apps

**Feature**: `005-beta-channel-ux` · Branch `005-beta-channel-ux`

## Prerequisites

```bash
bun install
bun run typecheck && bun run lint && bun run typecheck && bun run build
```

## 1. Hermetic suites

```bash
# server
bun --cwd packages/server test \
  src/__tests__/config/system-settings.test.ts \
  src/__tests__/deployments/update-info.test.ts \
  src/__tests__/deployments/persistence.test.ts \
  src/__tests__/deployments/channels.test.ts

# web
cd packages/web && npx vitest run \
  src/__tests__/pages/Settings.prerelease.test.tsx \
  src/__tests__/pages/Catalog.test.tsx \
  src/__tests__/pages/InstallWizard.channels.test.tsx \
  src/__tests__/pages/DeploymentDetail.test.tsx \
  src/__tests__/pages/Deployments.test.tsx

# cli
cd packages/cli && npx vitest run src/__tests__/channel.test.ts src/__tests__/settings-prerelease.test.ts src/__tests__/install.test.ts

# everything
bun run test
```

Expected: all green; the pre-existing `persistence.test.ts` assertion on `--channel` in the conflict message is replaced by a details-shape assertion.

## 2. Scenario walkthrough (dev stack or disposable VM)

The live catalog has one non-stable entry: `remo 0.11.0-beta.1` on `beta`.

1. **Not enrolled**: open the catalog. The remo card shows Install only, no pill, no "beta available". Open the wizard from the card: no Channel radio. Install → follows `stable`.
2. **Deep link with enrolment off**: `/catalog/remo/install?channel=beta` shows the radio with `beta` selected and the note naming `beta`.
3. **Enrol**: Settings → Pre-release apps → toggle on. Catalog remo card shows a `beta` pill. Wizard shows the radio.
4. **Join**: remo deployment → Overview → Channel block reads `Follows: stable · Running <v>, a stable build` → **Join beta** → confirm. Block reads `Follows: beta`; header offers `Upgrade to 0.11.0-beta.1 (beta)`.
5. **Upgrade**, then **Leave beta** → confirm dialog says "Stays on 0.11.0-beta.1 until a stable release at or above it is published." Block reads `Follows: stable · Running 0.11.0-beta.1, a beta build`; no update is offered.
6. **Separate copy**: from a stable copy, `Try beta in a separate copy →` → wizard on `beta` → install `remo-beta`. Each detail page shows the sibling sentence; reason is `channel`.
7. **Conflict**: with a single-instance app installed on stable, open its wizard via `?channel=beta` and finalize without override → panel with Switch / Open / Install a separate beta copy. Switch → the existing copy follows beta and the page navigates to it.
8. **List**: Deployments shows `beta` pills; the Pre-release chip narrows to those rows.
9. **CLI**: `hola channel <id>` → shows track and build; `hola channel <id> stable` → prints the stays-on note; `hola settings prerelease off` → catalog chrome disappears on next load; `hola install remo --channel beta` on a stable-installed single-instance app → surface-neutral message plus the CLI hint.

## 3. Quality gates

```bash
bun run typecheck && bun run lint && bun run typecheck && bun run test && bun run build
```
