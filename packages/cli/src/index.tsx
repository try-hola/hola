#!/usr/bin/env node
import sade from 'sade';

// Lazy command loaders to avoid unnecessary dependencies until invoked
const load = async <T,>(p: Promise<T>): Promise<T> => p;

const prog = sade('hola');

prog
  .version('0.1.0')
  .describe('Hola CLI — deployments and bundle developer workflow');

// bundle dev
prog
  .command('bundle dev')
  .describe('Start a dev session, sync files, validate and optionally deploy')
  .option('--path, -p', 'Bundle directory', '.')
  .option('--app-id', 'App ID')
  .option('--version', 'Version (default: dev)')
  .option('--watch', 'Watch glob', '')
  .option('--traefik', 'Traefik mode flag', false)
  .option('--no-deploy', 'Validate only, do not deploy', false)
  .option('--no-stream', 'Do not stream SSE during deploy', false)
  .action(async (opts) => {
    const { runBundleDev } = await load(import('./commands/bundle/dev'));
    await runBundleDev(opts);
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
  .describe('One-shot import → draft → validate → finalize → deploy')
  .option('--path, -p', 'Bundle directory', '.')
  .option('--app-id', 'App ID')
  .option('--version', 'Version')
  .option('--traefik', 'Require Traefik mode', false)
  .option('--no-stream', 'Do not stream SSE during deploy', false)
  .action(async (opts) => {
    const { runBundleDeploy } = await load(import('./commands/bundle/deploy'));
    await runBundleDeploy(opts);
  });

// Fallback banner when no args
if (process.argv.length <= 2) {
  // Minimal banner when no args
  console.log('Hola CLI ready. Try: hola bundle dev -p ./bundle --app-id app123 --version dev');
} else {
  prog.parse(process.argv);
}
