#!/usr/bin/env node
import sade from 'sade';

// Lazy command loaders to avoid unnecessary dependencies until invoked
const load = async <T,>(p: Promise<T>): Promise<T> => p;

const prog = sade('hola');

prog
  .version('0.1.0')
  .describe('Hola CLI — deployments and bundle developer workflow');

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
