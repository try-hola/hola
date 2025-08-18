import { HolaSdk } from '@hola/sdk';
import { promises as fs } from 'fs';
import path from 'path';

export async function runBundleValidate(opts: { path?: string; strict?: boolean; json?: boolean }) {
  const dir = path.resolve(process.cwd(), opts.path ?? '.');
  const composePath = path.join(dir, 'docker-compose.yaml');
  let composeYaml = '';
  try {
    composeYaml = await fs.readFile(composePath, 'utf8');
  } catch {
    console.error(`Compose file not found at ${composePath}`);
    process.exitCode = 1;
    return;
  }
  const sdk = new HolaSdk();
  const report = await sdk.validation.compose({ composeYaml });
  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  if (!report.ok && opts.strict) {
    console.error('Validation failed (strict).');
    for (const err of report.errors) console.error(`- ${err.message}`);
    process.exitCode = 1;
    return;
  }
  if (!report.ok) {
    console.warn('Validation has issues:');
    for (const err of report.errors) console.warn(`- ${err.message}`);
  } else {
    console.log('Validation OK');
  }
}
