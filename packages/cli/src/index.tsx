#!/usr/bin/env node
import sade from 'sade';

import { CLI_VERSION } from './version';

// Lazy command loaders to avoid unnecessary dependencies until invoked
const load = async <T,>(p: Promise<T>): Promise<T> => p;

const prog = sade('hola');

prog
  .version(CLI_VERSION)
  .describe('Hola CLI — install, deployments, and the bundle developer workflow');

// init — guided first-time setup (writes .env on this machine; no server needed)
prog
  .command('init')
  .describe('Interactively generate a Hola .env (validated, runs locally)')
  .option('--out', 'Path to write the .env (default <compose-dir>/.env)')
  .option('--compose-dir', 'Path to the packages/compose directory')
  .option('--force', 'Update an existing .env in place', false)
  .option('--skip-checks', 'Skip live DNS/credential/catalog validation', false)
  .option('--json', 'Print the resolved config as JSON (secrets redacted)', false)
  .action(async (opts) => {
    const { runInit } = await load(import('./commands/init/init'));
    await runInit(opts);
  });

// bootstrap — wizard + SSH into the host and run the full install
prog
  .command('bootstrap')
  .describe('Set up Hola on a remote host over SSH (wizard + install)')
  .option('--host', 'Target host, e.g. user@vm (required)')
  .option('--repo', 'Hola git repo to clone', 'https://github.com/try-hola/hola.git')
  .option('--ref', `Git ref to build on the host (default cli-v${CLI_VERSION})`)
  .option('--dir', 'Install directory on the host', '~/hola')
  .option('--env-file', 'Use an existing .env (skip the wizard)')
  .option('--skip-checks', 'Skip live DNS/credential/catalog validation', false)
  .option('--dry-run', 'Print the plan without connecting', false)
  .option('--json', 'Print the result as JSON', false)
  .action(async (opts) => {
    const { runBootstrap } = await load(import('./commands/bootstrap/bootstrap'));
    await runBootstrap(opts);
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
    await runCatalog(query, opts);
  });

// install — install a catalog app by id (draft from catalog → finalize → deploy)
prog
  .command('install <appId>')
  .describe('Install a catalog app: draft from catalog → validate → finalize → deploy → watch')
  .option('--version', 'App version', 'latest')
  .option('--name', 'Deployment name (default: the app id)')
  .option('--set', 'Override an env var, KEY=VALUE (repeatable)')
  .option('--strict', 'Fail on validation warnings', false)
  .option('--no-stream', 'Do not watch the deployment job', false)
  .option('--json', 'Print the result as JSON', false)
  .action(async (appId, opts) => {
    const { runInstall } = await load(import('./commands/install/install'));
    await runInstall(appId, opts);
  });

// deployments — list installed deployments
prog
  .command('deployments')
  .describe('List deployments')
  .option('--status', 'Filter by status (running, stopped, error, …)')
  .option('--json', 'Print raw JSON output', false)
  .action(async (opts) => {
    const { runDeploymentsList } = await load(import('./commands/deployments/deployments'));
    await runDeploymentsList(opts);
  });

// logs — print recent logs for a deployment (or live-tail with --follow)
prog
  .command('logs <deploymentId>')
  .describe('Print recent logs for a deployment')
  .option('--follow, -f', 'Live-tail logs over SSE until Ctrl-C', false)
  .option('--json', 'Print raw JSON output', false)
  .action(async (deploymentId, opts) => {
    const { runDeploymentLogs } = await load(import('./commands/deployments/deployments'));
    await runDeploymentLogs(deploymentId, opts);
  });

// stop / restart — lifecycle actions on a deployment
prog
  .command('stop <deploymentId>')
  .describe('Stop a deployment')
  .option('--no-stream', 'Do not watch the action job', false)
  .option('--json', 'Print the result as JSON', false)
  .action(async (deploymentId, opts) => {
    const { runDeploymentAction } = await load(import('./commands/deployments/actions'));
    await runDeploymentAction('stop', deploymentId, opts);
  });

prog
  .command('restart <deploymentId>')
  .describe('Restart a deployment')
  .option('--no-stream', 'Do not watch the action job', false)
  .option('--json', 'Print the result as JSON', false)
  .action(async (deploymentId, opts) => {
    const { runDeploymentAction } = await load(import('./commands/deployments/actions'));
    await runDeploymentAction('restart', deploymentId, opts);
  });

// uninstall — remove a deployment (containers, data, auth) — destructive
prog
  .command('uninstall <deploymentId>')
  .describe('Uninstall a deployment: stop it and remove its containers, data, and auth')
  .option('--yes, -y', 'Skip the confirmation prompt', false)
  .option('--json', 'Print the result as JSON', false)
  .action(async (deploymentId, opts) => {
    const { runUninstall } = await load(import('./commands/deployments/actions'));
    await runUninstall(deploymentId, opts);
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
    await runRollback(deploymentId, opts);
  });

// bundle validate
prog
  .command('bundle validate')
  .describe('Validate compose/env with server ValidationService')
  .option('--path, -p', 'Bundle directory', '.')
  .option('--strict', 'Upgrade warnings to failures', false)
  .option('--json', 'Print raw JSON output', false)
  .action(async (opts) => {
    const { runBundleValidate } = await load(import('./commands/bundle/validate'));
    await runBundleValidate(opts);
  });

// bundle deploy (one-shot)
prog
  .command('bundle deploy')
  .describe('One-shot import → draft → validate → preflight → finalize → deploy → watch')
  .option('--path, -p', 'Bundle directory', '.')
  .option('--app-id', 'App ID (defaults to the bundle directory name)')
  .option('--version', 'Version', 'latest')
  .option('--port', 'Ingress container port Traefik routes to (e.g. 3000 for Gitea)')
  .option('--traefik', 'Require Traefik mode', false)
  .option('--strict', 'Fail on validation warnings', false)
  .option('--no-stream', 'Do not watch the deployment job', false)
  .option('--json', 'Print the result as JSON', false)
  .action(async (opts) => {
    const { runBundleDeploy } = await load(import('./commands/bundle/deploy'));
    await runBundleDeploy(opts);
  });

// Fallback banner when no args
if (process.argv.length <= 2) {
  // Minimal banner when no args
  console.log('Hola CLI ready. Try: hola catalog · hola install <app> · hola deployments');
} else {
  prog.parse(process.argv);
}
