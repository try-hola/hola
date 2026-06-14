#!/usr/bin/env node
import sade from 'sade';

// Lazy command loaders to avoid unnecessary dependencies until invoked
const load = async <T,>(p: Promise<T>): Promise<T> => p;

const prog = sade('hola');

prog
  .version('0.2.0')
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
  console.log('Hola CLI ready. Try: hola bundle validate -p ./bundle or hola bundle deploy -p ./bundle');
} else {
  prog.parse(process.argv);
}
