import { describe, it, expect } from 'vitest';

import { HolaSdk, HolaApiError } from '@hola/sdk';

// Exercises the SDK's error parsing (parseJson, spec 005 R6) indirectly
// through a real HolaSdk instance with a stubbed `fetchImpl`, rather than a
// stubbed SDK object as most CLI command tests use — this is the only place
// the SDK's own error-handling behaviour gets test coverage, since
// `packages/sdk` has no test runner of its own (build/typecheck/lint only).

function sdkWithFetch(fetchImpl: typeof fetch) {
  return new HolaSdk({ baseUrl: 'http://test.local', fetchImpl });
}

function jsonResponse(status: number, statusText: string, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { 'content-type': 'application/json' },
  });
}

function textResponse(status: number, statusText: string, body: string) {
  return new Response(body, {
    status,
    statusText,
    headers: { 'content-type': 'text/plain' },
  });
}

describe('SDK error parsing (HolaApiError)', () => {
  it('parses a structured { error: {...} } JSON body into a HolaApiError with the server message', async () => {
    const fetchImpl = (async () =>
      jsonResponse(409, 'Conflict', {
        error: {
          code: 'CONFLICT',
          message: "'gitea' is already installed as 'gitea' and follows 'stable'.",
          details: { code: 'ALREADY_INSTALLED', existing: { id: 'dep-1', name: 'gitea', channel: 'stable' }, channelPublished: true },
          requestId: 'req-123',
        },
      })) as unknown as typeof fetch;
    const sdk = sdkWithFetch(fetchImpl);

    let caught: unknown;
    try {
      await sdk.settings.get();
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(HolaApiError);
    const err = caught as HolaApiError;
    expect(err.message).toBe("'gitea' is already installed as 'gitea' and follows 'stable'.");
    expect(err.status).toBe(409);
    expect(err.code).toBe('CONFLICT');
    expect(err.details).toEqual({ code: 'ALREADY_INSTALLED', existing: { id: 'dep-1', name: 'gitea', channel: 'stable' }, channelPublished: true });
    expect(err.requestId).toBe('req-123');
  });

  it('falls back to the legacy HTTP <status> <statusText>: <text> message for a plain-text (non-JSON) error body, still throwing a HolaApiError', async () => {
    const fetchImpl = (async () => textResponse(500, 'Internal Server Error', 'boom')) as unknown as typeof fetch;
    const sdk = sdkWithFetch(fetchImpl);

    let caught: unknown;
    try {
      await sdk.settings.get();
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(HolaApiError);
    const err = caught as HolaApiError;
    expect(err.message).toBe('HTTP 500 Internal Server Error: boom');
    expect(err.status).toBe(500);
    expect(err.code).toBeUndefined();
    expect(err.details).toBeUndefined();
    expect(err.requestId).toBeUndefined();
  });
});
