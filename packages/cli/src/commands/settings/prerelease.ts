import { HolaSdk } from '@hola/sdk';
import type { GetSettingsResponse, PatchSettingsResponse } from '@hola/shared';

import { reportDeployError } from '../../lib/deploy-flow';

export interface SettingsPrereleaseOptions {
  json?: boolean;
}

const USAGE = 'Usage: hola settings prerelease [on|off]';

/**
 * `hola settings prerelease [on|off]` — the dashboard-wide gate that shows
 * pre-release (beta/rc) catalog channels in Catalog/wizard/list discovery
 * chrome (spec 005, R10). Never changes what channel an installed copy
 * follows — see `hola channel`.
 */
export async function runSettingsPrerelease(
  value: string | undefined,
  opts: SettingsPrereleaseOptions,
  injected?: { sdk?: HolaSdk }
): Promise<GetSettingsResponse | PatchSettingsResponse | undefined> {
  const sdk = injected?.sdk ?? new HolaSdk();
  const out = (m: string) => console.log(m);
  try {
    if (value === undefined) {
      const settings = (await sdk.settings.get()) as GetSettingsResponse;
      const on = settings.channels?.showPrerelease === true;
      if (opts.json) {
        console.log(JSON.stringify(settings, null, 2));
      } else {
        out(`Show pre-release channels: ${on ? 'on' : 'off'}`);
      }
      return settings;
    }

    if (value !== 'on' && value !== 'off') {
      console.error(USAGE);
      process.exitCode = 1;
      return undefined;
    }

    const showPrerelease = value === 'on';
    const res = (await sdk.settings.update({ channels: { showPrerelease } })) as PatchSettingsResponse;
    if (opts.json) {
      console.log(JSON.stringify(res, null, 2));
    } else {
      out(`Show pre-release channels: ${value}`);
    }
    return res;
  } catch (err) {
    return reportDeployError(err);
  }
}
