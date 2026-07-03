#!/usr/bin/env node
import sade from 'sade';

import { CLI_VERSION } from './version';
import { camelKeys, streamOpts } from './lib/opts';

// Lazy command loaders to avoid unnecessary dependencies until invoked
const load = async <T,>(p: Promise<T>): Promise<T> => p;

const prog = sade('hola');

prog
  .version(CLI_VERSION)
  .describe('Hola CLI — set up a server, browse the catalog, install apps, and manage deployments');

// init — guided first-time setup (writes .env on this machine; no server needed)
// Optional: `hola bootstrap` does the wizard + install in one step. init is for
// when you want the validated .env on its own (review/edit, secrets manager, CI).
prog
  .command('init')
  .describe('Optional: generate a validated .env locally (bootstrap does this + installs)')
  .option('--out', 'Path to write the .env (default <compose-dir>/.env)')
  .option('--compose-dir', 'Path to the packages/compose directory')
  .option('--force', 'Update an existing .env in place', false)
  .option('--skip-checks', 'Skip live DNS/credential/catalog validation', false)
  .option('--keep-env', 'Keep the local .env after a successful remote install', false)
  .option('--json', 'Print the resolved config as JSON (secrets redacted)', false)
  .action(async (opts) => {
    const { runInit } = await load(import('./commands/init/init'));
    await runInit(camelKeys(opts));
  });

// bootstrap — wizard + SSH into the host and run the full install
prog
  .command('bootstrap')
  .describe('Install Hola on a host over SSH — the one-step setup (wizard + install)')
  .option('--host', 'Target host, e.g. user@vm (required)')
  .option('--repo', 'Hola repo to download release assets from', 'https://github.com/try-hola/hola.git')
  .option('--ref', `Release tag to install (default cli-v${CLI_VERSION})`)
  .option('--tarball-url', 'Override the compose-bundle download URL (advanced)')
  .option('--dir', 'Install directory on the host', '/opt/hola')
  .option('--env-file', 'Use an existing .env (skip the wizard)')
  .option('--skip-checks', 'Skip live DNS/credential/catalog validation', false)
  .option('--dry-run', 'Print the plan without connecting', false)
  .option('--json', 'Print the result as JSON', false)
  .action(async (opts) => {
    const { runBootstrap } = await load(import('./commands/bootstrap/bootstrap'));
    await runBootstrap(camelKeys(opts));
  });

// update — upgrade an existing install to this CLI's version (config-preserving, no wizard)
prog
  .command('update')
  .describe('Upgrade the CLI to the latest release, then the host to match, over SSH — preserves .env')
  .option('--host', 'Target host, e.g. user@vm (required)')
  .option('--repo', 'Hola repo to download release assets from', 'https://github.com/try-hola/hola.git')
  .option('--ref', `Release tag to install (default cli-v${CLI_VERSION}); pinning a ref skips the CLI self-update`)
  .option('--no-self-update', 'Don’t upgrade the CLI binary; only update the server to this CLI’s version')
  .option('--tarball-url', 'Override the compose-bundle download URL (advanced)')
  .option('--dir', 'Install directory on the host', '/opt/hola')
  .option('--enable-sso', 'For a HOLA_AUTH_MODE=none host: enable Authentik SSO (the new standard)', false)
  .option('--keep-auth-mode', 'For a HOLA_AUTH_MODE=none host: keep SSO off (no prompt)', false)
  .option('--no-backup', 'Skip the pre-upgrade snapshot (.env + traefik/acme + hola-data volume)')
  .option('--backup-app-data', 'Also include the (large) app-data bind root in the pre-upgrade snapshot', false)
  .option('--check', 'Report CLI / installed / latest versions without changing anything', false)
  .option('--dry-run', 'Print the plan without connecting', false)
  .option('--json', 'Print the result as JSON', false)
  .action(async (opts) => {
    const { runUpdate } = await load(import('./commands/update/update'));
    await runUpdate(camelKeys(opts));
  });

// teardown — remove a Hola deployment from a host over SSH (inverse of bootstrap)
prog
  .command('teardown')
  .describe('Tear down Hola on a host over SSH — destructive (removes containers, volumes, data)')
  .option('--host', 'Target host, e.g. user@vm (required)')
  .option('--dir', 'Install directory on the host', '/opt/hola')
  .option('--keep-data', 'Only stop/remove containers; keep volumes and the data/install dirs', false)
  .option('--images', 'Also remove the ghcr.io/try-hola/* images', false)
  .option('--include-certs', 'Also wipe the Let’s Encrypt cert store (kept by default to avoid re-issuance)', false)
  .option('--yes, -y', 'Skip the confirmation prompt', false)
  .option('--dry-run', 'Print the plan without connecting', false)
  .option('--json', 'Print the result as JSON', false)
  .action(async (opts) => {
    const { runTeardown } = await load(import('./commands/teardown/teardown'));
    await runTeardown(camelKeys(opts));
  });

// credentials — retrieve post-install credentials for a host (re-run anytime)
prog
  .command('credentials')
  .describe('Fetch a host’s credentials: save the CLI API key locally and surface the SSO admin link')
  .option('--host', 'Target host, e.g. user@vm (required)')
  .option('--dir', 'Install directory on the host', '/opt/hola')
  .option('--show-password', 'Reveal the akadmin fallback password (only when there is no named admin)', false)
  .option('--json', 'Print the result as JSON', false)
  .action(async (opts) => {
    const { runCredentials } = await load(import('./commands/credentials/credentials'));
    await runCredentials(camelKeys(opts));
  });

// catalog — browse the app catalog
prog
  .command('catalog [query]')
  .describe('Browse the app catalog (optionally filter by query)')
  .option('--category', 'Filter by category')
  .option('--limit', 'Max apps to list', 100)
  .option('--json', 'Print raw JSON output', false)
  .action(async (query, opts) => {
    const { runCatalog } = await load(import('./commands/catalog/catalog'));
    await runCatalog(query, camelKeys(opts));
  });

// install — install a catalog app by id (draft from catalog → finalize → deploy)
// Note: the app version is `--app-version`, not `--version` — the latter is sade's
// global flag (prints the CLI version), so it can never reach this handler. You can
// also pin a version inline as `hola install <appId>@<version>`.
prog
  .command('install <appId>')
  .describe('Install a catalog app, or a package by OCI reference: draft → validate → finalize → deploy → watch')
  .example('install uptime-kuma@1.2.1')
  .example('install ghcr.io/acme/hola-cms:0.1.0 --registry-cred acme')
  .option('--app-version', 'App version to install (or use <appId>@<version>)', 'latest')
  .option('--name', 'Deployment name (default: the app id)')
  .option('--set', 'Override an env var, KEY=VALUE (repeatable)')
  .option('--registry-cred', 'Stored registry credential id for a private OCI reference install')
  .option('--strict', 'Fail on validation warnings', false)
  .option('--no-stream', 'Do not watch the deployment job', false)
  .option('--json', 'Print the result as JSON', false)
  .action(async (appId, opts) => {
    const { runInstall } = await load(import('./commands/install/install'));
    await runInstall(appId, streamOpts(opts));
  });

// registry-cred — manage stored credentials for private OCI pulls
prog
  .command('registry-cred <action> [id]')
  .describe('Manage private registry credentials: add | list | rm')
  .example('registry-cred add --registry ghcr.io --username acme --token <PAT> --id acme')
  .example('registry-cred list')
  .example('registry-cred rm acme')
  .option('--id', 'Credential id (for add; generated when omitted)')
  .option('--registry', 'Registry host the credential authorizes, e.g. ghcr.io')
  .option('--username', 'Registry username')
  .option('--token', 'Registry token/password (e.g. a GHCR PAT with read:packages)')
  .option('--json', 'Print raw JSON output', false)
  .action(async (action, id, opts) => {
    const { runRegistryCred } = await load(import('./commands/registry/registry'));
    await runRegistryCred(action, camelKeys(opts), { args: id ? [id] : [] });
  });

// deployments — list installed deployments
prog
  .command('deployments')
  .describe('List deployments')
  .option('--status', 'Filter by status (running, stopped, error, …)')
  .option('--json', 'Print raw JSON output', false)
  .action(async (opts) => {
    const { runDeploymentsList } = await load(import('./commands/deployments/deployments'));
    await runDeploymentsList(camelKeys(opts));
  });

// logs — print recent logs for a deployment (or live-tail with --follow)
prog
  .command('logs <deploymentId>')
  .describe('Print recent logs for a deployment')
  .option('--follow, -f', 'Live-tail logs over SSE until Ctrl-C', false)
  .option('--json', 'Print raw JSON output', false)
  .action(async (deploymentId, opts) => {
    const { runDeploymentLogs } = await load(import('./commands/deployments/deployments'));
    await runDeploymentLogs(deploymentId, camelKeys(opts));
  });

// stop / restart — lifecycle actions on a deployment
prog
  .command('stop <deploymentId>')
  .describe('Stop a deployment')
  .option('--no-stream', 'Do not watch the action job', false)
  .option('--json', 'Print the result as JSON', false)
  .action(async (deploymentId, opts) => {
    const { runDeploymentAction } = await load(import('./commands/deployments/actions'));
    await runDeploymentAction('stop', deploymentId, streamOpts(opts));
  });

prog
  .command('restart <deploymentId>')
  .describe('Restart a deployment')
  .option('--no-stream', 'Do not watch the action job', false)
  .option('--json', 'Print the result as JSON', false)
  .action(async (deploymentId, opts) => {
    const { runDeploymentAction } = await load(import('./commands/deployments/actions'));
    await runDeploymentAction('restart', deploymentId, streamOpts(opts));
  });

// uninstall — remove a deployment (containers, data, auth) — destructive
prog
  .command('uninstall <deploymentId>')
  .describe('Uninstall a deployment: stop it and remove its containers, data, and auth')
  .option('--yes, -y', 'Skip the confirmation prompt', false)
  .option('--json', 'Print the result as JSON', false)
  .action(async (deploymentId, opts) => {
    const { runUninstall } = await load(import('./commands/deployments/actions'));
    await runUninstall(deploymentId, camelKeys(opts));
  });

// rollback — roll a deployment back to a previous release
prog
  .command('rollback <deploymentId>')
  .describe('Roll a deployment back to a previous release')
  .option('--to', 'Target release id (default: the previous release)')
  .option('--reason', 'Reason recorded with the rollback')
  .option('--no-stream', 'Do not watch the rollback job', false)
  .option('--json', 'Print the result as JSON', false)
  .action(async (deploymentId, opts) => {
    const { runRollback } = await load(import('./commands/deployments/actions'));
    await runRollback(deploymentId, streamOpts(opts));
  });

// upgrade — promote a deployment to a newer catalog version (carries env forward,
// runs the upgrade skip-guard + pre-upgrade snapshot)
prog
  .command('upgrade <deploymentId>')
  .describe('Upgrade a deployment to a newer catalog version')
  .example('upgrade guacamole-ab12cd34            # to the latest available version')
  .example('upgrade guacamole-ab12cd34 --app-version 2.0.0')
  .option('--app-version', 'Target catalog version (default: the latest available)')
  .option('--snapshot', 'Force a pre-upgrade data snapshot even if the target does not require one', false)
  .option('--no-stream', 'Do not watch the upgrade job', false)
  .option('--json', 'Print the result as JSON', false)
  .action(async (deploymentId, opts) => {
    const { runUpgrade } = await load(import('./commands/deployments/actions'));
    await runUpgrade(deploymentId, streamOpts(opts));
  });

// Fallback banner when no args
if (process.argv.length <= 2) {
  // Minimal banner when no args. Lead with setup for first-time users, then the
  // day-to-day commands for an installed server.
  console.log('Hola CLI. New here? Set up a server: hola bootstrap --host user@vm');
  console.log('Installed? Try: hola catalog · hola install <app> · hola deployments');
} else {
  prog.parse(process.argv);
}
