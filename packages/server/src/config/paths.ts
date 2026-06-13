import { homedir, tmpdir } from 'os';
import { resolve } from 'path';

export const HOLA_DATA_DIR_ENV = 'HOLA_DATA_DIR';

export function getHolaDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const configuredPath = env[HOLA_DATA_DIR_ENV]?.trim();
  if (configuredPath) {
    return resolve(configuredPath);
  }

  const homeDir = env.HOME || env.USERPROFILE || homedir() || tmpdir();
  return resolve(homeDir, '.hola');
}
