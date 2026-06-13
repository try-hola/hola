import { HolaSdk } from '@hola/sdk';
import { promises as fs } from 'fs';
import path from 'path';
import type { CreateDraftResponse, ValidateDraftResponse } from '@hola/shared';

export async function runBundleValidate(opts: { path?: string; strict?: boolean; json?: boolean }) {
  const dir = path.resolve(process.cwd(), opts.path ?? '.');
  const composePath = path.join(dir, 'docker-compose.yaml');
  let composeYaml: string;
  try {
    composeYaml = await fs.readFile(composePath, 'utf8');
  } catch {
    console.error(`Compose file not found at ${composePath}`);
    process.exitCode = 1;
    return;
  }

  const sdk = new HolaSdk();
  
  try {
    // Create a temporary draft for validation
    const draft = (await sdk.drafts.create({ 
      appId: 'validation-temp', 
      version: 'temp' 
    })) as CreateDraftResponse;
    
    // Upload the compose file to the draft
    await sdk.drafts.uploadFile(draft.draftId, 'docker-compose.yaml', composeYaml);
    
    // Validate the draft
    const report = (await sdk.drafts.validate(draft.draftId)) as ValidateDraftResponse;
    
    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    
    const hasErrors = report.errors && report.errors.length > 0;
    const hasWarnings = report.warnings && report.warnings.length > 0;
    
    if (hasErrors && opts.strict) {
      console.error('Validation failed (strict).');
      for (const err of report.errors) console.error(`- ${err.message}`);
      process.exitCode = 1;
      return;
    }
    
    if (hasErrors || hasWarnings) {
      if (hasErrors) {
        console.warn('Validation has errors:');
        for (const err of report.errors) console.warn(`- ${err.message}`);
      }
      if (hasWarnings) {
        console.warn('Validation has warnings:');
        for (const warn of report.warnings) console.warn(`- ${warn.message}`);
      }
    } else {
      console.log('Validation OK');
    }
  } catch (error) {
    console.error('Validation failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
