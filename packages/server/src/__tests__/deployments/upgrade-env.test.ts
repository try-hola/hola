/**
 * Carry-forward merge for the promote (upgrade) path — `mergeUpgradeAppEnv`.
 *
 * The route (server.ts, POST /api/deployments/:id/promote) builds a draft for
 * the target version and then merges the deployment's current config onto it.
 * This pins what that merge does with each class of key, in particular the one
 * that broke real upgrades (#458): a generated secret the NEW version
 * introduces.
 */

import { describe, test, expect } from 'bun:test';
import type { AppEnvVar } from '@hola/shared';

import { mergeUpgradeAppEnv } from '../../services/core/upgrade-env';

const env = (over: Partial<AppEnvVar> & { key: string }): AppEnvVar => ({
  value: '',
  isSecret: false,
  ...over,
});

describe('mergeUpgradeAppEnv', () => {
  test("the operator's existing value wins over the new version's default", () => {
    const merged = mergeUpgradeAppEnv(
      [env({ key: 'TZ', value: 'UTC' })],
      { TZ: 'America/New_York' },
    );
    expect(merged[0].value).toBe('America/New_York');
  });

  test('an empty carried value is still the operator\'s choice, not a gap to fill', () => {
    const merged = mergeUpgradeAppEnv(
      [env({ key: 'MOTD', value: 'hello' })],
      { MOTD: '' },
    );
    expect(merged[0].value).toBe('');
  });

  test('a generated secret the new version introduces is minted, not refused (#458)', () => {
    // calibre-web 1.2.x added OPDS_BYPASS_PASSWORD (isSecret + generate) to a
    // package whose installs predate the key. Before this, every existing
    // install failed to upgrade with "OPDS/Kobo access password is required".
    const merged = mergeUpgradeAppEnv(
      [env({ key: 'OPDS_BYPASS_PASSWORD', isSecret: true, generate: { kind: 'hex', length: 16 } })],
      { TZ: 'UTC' },
    );
    expect(merged[0].value).toMatch(/^[0-9a-f]{32}$/);
  });

  test('a carried generated secret is NOT re-minted — rotating it silently would break readers', () => {
    const merged = mergeUpgradeAppEnv(
      [env({ key: 'OPDS_BYPASS_PASSWORD', isSecret: true, generate: { kind: 'hex', length: 16 } })],
      { OPDS_BYPASS_PASSWORD: 'the-existing-one' },
    );
    expect(merged[0].value).toBe('the-existing-one');
  });

  test('two generated keys get two different values', () => {
    const merged = mergeUpgradeAppEnv(
      [
        env({ key: 'A', isSecret: true, generate: { kind: 'hex', length: 16 } }),
        env({ key: 'B', isSecret: true, generate: { kind: 'hex', length: 16 } }),
      ],
      {},
    );
    expect(merged[0].value).not.toBe(merged[1].value);
  });

  test('a new version default the deployment has never seen rides through untouched', () => {
    const merged = mergeUpgradeAppEnv([env({ key: 'NEW_FLAG', value: 'on' })], {});
    expect(merged[0].value).toBe('on');
  });

  test('a required key with real-world meaning is still left empty for finalize to reject', () => {
    // No `generate` recipe: an API token or an email address must not be
    // fabricated, so the upgrade must still stop and name it.
    const merged = mergeUpgradeAppEnv([env({ key: 'SMTP_FROM', isSecret: false })], {});
    expect(merged[0].value).toBe('');
  });

  test('every other field of the entry is preserved', () => {
    const merged = mergeUpgradeAppEnv(
      [env({ key: 'PW', isSecret: true, label: 'Password', description: 'why', generate: { kind: 'hex', length: 8 } })],
      {},
    );
    expect(merged[0]).toMatchObject({ key: 'PW', isSecret: true, label: 'Password', description: 'why' });
  });
});
