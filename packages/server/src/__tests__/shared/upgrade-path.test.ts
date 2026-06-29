/**
 * checkUpgradePath — the pure skip-guard helper (#284 Phase 0).
 *
 * Lives in the server suite because @hola/shared has no test runner of its own
 * (same arrangement as compareVersions/isNewerVersion, exercised from system/).
 */
import { describe, test, expect } from 'bun:test';

import { checkUpgradePath, type AppUpgradeMeta } from '@hola/shared';

describe('checkUpgradePath (#284 Phase 0 skip-guard)', () => {
  test('passes through when there is no metadata', () => {
    expect(checkUpgradePath('1.0.0', '2.0.0', undefined)).toEqual({ ok: true });
    expect(checkUpgradePath('1.0.0', '2.0.0', {})).toEqual({ ok: true });
  });

  test('passes through when either version is unknown', () => {
    const meta: AppUpgradeMeta = { minFromVersion: '5.0.0' };
    expect(checkUpgradePath(undefined, '2.0.0', meta)).toEqual({ ok: true });
    expect(checkUpgradePath('1.0.0', undefined, meta)).toEqual({ ok: true });
  });

  test('passes through for a same-version re-promote or a downgrade', () => {
    const meta: AppUpgradeMeta = { minFromVersion: '5.0.0', waypoints: ['3.0.0'] };
    expect(checkUpgradePath('2.0.0', '2.0.0', meta)).toEqual({ ok: true });
    expect(checkUpgradePath('4.0.0', '2.0.0', meta)).toEqual({ ok: true });
  });

  // --- minFromVersion floor (H2) -------------------------------------------

  test('rejects an upgrade from below the minFromVersion floor', () => {
    const meta: AppUpgradeMeta = { minFromVersion: '1.107.2' };
    const r = checkUpgradePath('1.100.0', '1.140.0', meta);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('min-from-version');
      expect(r.suggestedVersion).toBe('1.107.2');
      expect(r.message).toContain('1.107.2');
      expect(r.message).toContain('1.100.0');
    }
  });

  test('allows an upgrade when already at/above the floor', () => {
    const meta: AppUpgradeMeta = { minFromVersion: '1.107.2' };
    expect(checkUpgradePath('1.107.2', '1.140.0', meta)).toEqual({ ok: true });
    expect(checkUpgradePath('1.120.0', '1.140.0', meta)).toEqual({ ok: true });
  });

  // --- waypoints (H2) ------------------------------------------------------

  test('rejects skipping past a required waypoint and names the next stop', () => {
    const meta: AppUpgradeMeta = { waypoints: ['1.132.3'] };
    const r = checkUpgradePath('1.130.0', '1.137.0', meta);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('waypoint-required');
      expect(r.suggestedVersion).toBe('1.132.3');
      expect(r.message).toContain('1.132.3');
    }
  });

  test('suggests the LOWEST waypoint still ahead when several are crossed', () => {
    const meta: AppUpgradeMeta = { waypoints: ['1.135.0', '1.132.3'] };
    const r = checkUpgradePath('1.130.0', '1.140.0', meta);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.suggestedVersion).toBe('1.132.3');
  });

  test('allows the upgrade once landed on the waypoint', () => {
    const meta: AppUpgradeMeta = { waypoints: ['1.132.3'] };
    expect(checkUpgradePath('1.132.3', '1.137.0', meta)).toEqual({ ok: true });
  });

  test('ignores waypoints outside the (from, to) window', () => {
    const meta: AppUpgradeMeta = { waypoints: ['0.9.0', '5.0.0'] };
    expect(checkUpgradePath('1.0.0', '2.0.0', meta)).toEqual({ ok: true });
  });

  test('the floor is reported before a waypoint when both fail', () => {
    const meta: AppUpgradeMeta = { minFromVersion: '1.5.0', waypoints: ['1.8.0'] };
    const r = checkUpgradePath('1.0.0', '2.0.0', meta);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('min-from-version');
  });
});
