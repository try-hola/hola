import { describe, expect, it } from 'vitest';
import { chownGuidance, remoteFailureMessage } from '../lib/remote-failure';

describe('remoteFailureMessage', () => {
  it('255 is a connection failure; other codes name the step; a signal is a lost connection', () => {
    expect(remoteFailureMessage('h', 's', { code: 255, stderr: 'refused' })).toBe('Could not connect to h (ssh exit 255): refused');
    expect(remoteFailureMessage('h', 'Read x', { code: 1, stderr: '' })).toBe('"Read x" failed on h (exit 1)');
    expect(remoteFailureMessage('h', 's', { code: 1, signal: 'SIGKILL' })).toContain('Lost the SSH connection');
  });

  it('keeps only the last three non-empty stderr lines', () => {
    const m = remoteFailureMessage('h', 's', { code: 2, stderr: 'a\n\n b \nc\nd\n' });
    expect(m).toBe('"s" failed on h (exit 2): b | c | d');
  });
});

describe('chownGuidance', () => {
  it('quotes the dir', () => {
    expect(chownGuidance('a', 'b', '/srv/my hola')).toContain("sudo chown -R a:b '/srv/my hola'");
  });
});
