import { describe, it, expect } from 'bun:test';

import { readCookie, SESSION_COOKIE } from '../../middleware/auth';

function reqWithCookie(cookie: string | null): Request {
  const headers = new Headers();
  if (cookie !== null) headers.set('cookie', cookie);
  return new Request('https://app.example.com/api/deployments', { headers });
}

describe('readCookie', () => {
  it('returns null when there is no Cookie header', () => {
    expect(readCookie(reqWithCookie(null), SESSION_COOKIE)).toBeNull();
  });

  it('reads a single cookie value', () => {
    expect(readCookie(reqWithCookie(`${SESSION_COOKIE}=abc123`), SESSION_COOKIE)).toBe('abc123');
  });

  it('reads the right cookie among several', () => {
    const req = reqWithCookie(`theme=dark; ${SESSION_COOKIE}=secret-key; other=1`);
    expect(readCookie(req, SESSION_COOKIE)).toBe('secret-key');
  });

  it('URL-decodes the cookie value', () => {
    expect(readCookie(reqWithCookie(`${SESSION_COOKIE}=a%20b%3Dc`), SESSION_COOKIE)).toBe('a b=c');
  });

  it('returns null for an absent cookie name', () => {
    expect(readCookie(reqWithCookie('theme=dark'), SESSION_COOKIE)).toBeNull();
  });
});
