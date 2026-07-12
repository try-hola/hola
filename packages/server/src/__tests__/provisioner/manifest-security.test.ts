/**
 * Unit tests for coerceManifestSecurity / requestsPrivilegeEscalation.
 *
 * The catalog drops unknown manifest fields, so the `security` block is coerced
 * defensively: well-formed elevated-permission entries pass through, malformed
 * ones are dropped (a manifest can't invent a privilege or request one without a
 * reason), and a block with nothing valid degrades to undefined (fully hardened).
 */

import { describe, test, expect } from 'bun:test';
import { coerceManifestSecurity, requestsPrivilegeEscalation } from '../../services/core/manifest-security';

describe('coerceManifestSecurity', () => {
  test('returns undefined for missing/non-object/empty input', () => {
    expect(coerceManifestSecurity(undefined)).toBeUndefined();
    expect(coerceManifestSecurity(null)).toBeUndefined();
    expect(coerceManifestSecurity('allow-privilege-escalation')).toBeUndefined();
    expect(coerceManifestSecurity([])).toBeUndefined();
    expect(coerceManifestSecurity({})).toBeUndefined();
    expect(coerceManifestSecurity({ elevated: [] })).toBeUndefined();
  });

  test('coerces a well-formed privilege-escalation request', () => {
    const out = coerceManifestSecurity({
      elevated: [{ type: 'allow-privilege-escalation', reason: 'Desktop needs sudo.' }],
    });
    expect(out).toEqual({ elevated: [{ type: 'allow-privilege-escalation', reason: 'Desktop needs sudo.' }] });
  });

  test('trims the reason and drops entries missing a reason', () => {
    expect(
      coerceManifestSecurity({ elevated: [{ type: 'allow-privilege-escalation', reason: '  needs sudo  ' }] })
    ).toEqual({ elevated: [{ type: 'allow-privilege-escalation', reason: 'needs sudo' }] });

    // reason absent / blank -> entry dropped -> whole block undefined.
    expect(coerceManifestSecurity({ elevated: [{ type: 'allow-privilege-escalation' }] })).toBeUndefined();
    expect(
      coerceManifestSecurity({ elevated: [{ type: 'allow-privilege-escalation', reason: '   ' }] })
    ).toBeUndefined();
  });

  test('drops unknown permission types (forward-compat: no invented privileges)', () => {
    expect(
      coerceManifestSecurity({ elevated: [{ type: 'allow-everything', reason: 'nope' }] })
    ).toBeUndefined();
    // known + unknown -> only the known one survives.
    expect(
      coerceManifestSecurity({
        elevated: [
          { type: 'privileged-mode', reason: 'no' },
          { type: 'allow-privilege-escalation', reason: 'yes' },
        ],
      })
    ).toEqual({ elevated: [{ type: 'allow-privilege-escalation', reason: 'yes' }] });
  });

  test('de-duplicates repeated types (first wins)', () => {
    expect(
      coerceManifestSecurity({
        elevated: [
          { type: 'allow-privilege-escalation', reason: 'first' },
          { type: 'allow-privilege-escalation', reason: 'second' },
        ],
      })
    ).toEqual({ elevated: [{ type: 'allow-privilege-escalation', reason: 'first' }] });
  });
});

describe('requestsPrivilegeEscalation', () => {
  test('true only when the escalation grant is present', () => {
    expect(requestsPrivilegeEscalation(undefined)).toBe(false);
    expect(requestsPrivilegeEscalation({ elevated: [] })).toBe(false);
    expect(
      requestsPrivilegeEscalation({ elevated: [{ type: 'allow-privilege-escalation', reason: 'x' }] })
    ).toBe(true);
  });
});
