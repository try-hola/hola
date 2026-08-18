/**
 * Contract-scoped tokens (ADR 0004 §6, #418 Phase 3).
 *
 * A brokered contract has the provider app calling the server, so it needs a
 * credential. These tests pin the properties that make handing one to a catalog
 * container acceptable: it authorizes exactly its own contract endpoints, it is
 * stored hashed, re-minting invalidates the previous one, and uninstalling the
 * app kills it.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { RealStorageService } from '../../services/core/storage';
import { RealContractTokenService, createContractTokenAuthProvider } from '../../services/auth/contract-tokens';
import { getRequiredCapability } from '../../middleware/auth';

describe('contract-scoped tokens', () => {
  let dataRoot: string;
  let storage: RealStorageService;
  let service: RealContractTokenService;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'hola-contract-tokens-'));
    storage = new RealStorageService({ holaDir: dataRoot });
    service = new RealContractTokenService(storage);
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  test('authorizes exactly the contracts it was minted for, and nothing else', async () => {
    const token = await service.mint('backrest-1234', ['backup@1']);
    const result = await service.authenticateToken(token);

    expect(result.success).toBe(true);
    expect(result.principal?.capabilities).toEqual(['contract:backup']);
    // The whole point: not a general-purpose credential. `write:deployments` is
    // what an unmatched mutating route falls back to, so its absence is what keeps
    // a leaked token from being able to install or delete anything.
    expect(result.principal?.capabilities).not.toContain('write:deployments');
    expect(result.principal?.capabilities).not.toContain('*');
    expect(result.principal?.metadata?.deploymentId).toBe('backrest-1234');
  });

  test('the contract endpoints ask for the contract capability, not the write default', async () => {
    // If this rule ever goes missing the route still "works" — it just silently
    // demands `write:deployments` instead, which no contract token has and which
    // would be far too much to grant one.
    expect(getRequiredCapability('/api/contracts/backup/prepare', 'POST')).toBe('contract:backup');
    expect(getRequiredCapability('/api/contracts/backup/finalize', 'POST')).toBe('contract:backup');
    expect(getRequiredCapability('/api/deployments', 'POST')).toBe('write:deployments');
  });

  test('the provider adapter refuses a capability the token was not minted for', async () => {
    const provider = createContractTokenAuthProvider(service);
    const token = await service.mint('backrest-1234', ['backup@1']);
    const { principal } = await provider.authenticate(token);

    expect(provider.hasCapability(principal!, 'contract:backup')).toBe(true);
    expect(provider.hasCapability(principal!, 'write:deployments')).toBe(false);
    // A contract principal can never carry `*`, so asking for it must not pass
    // through some wildcard shortcut.
    expect(provider.hasCapability(principal!, '*')).toBe(false);
  });

  test('rejects an unknown token and ignores one that is not ours', async () => {
    await service.mint('backrest-1234', ['backup@1']);
    expect((await service.authenticateToken('hct_deadbeef')).success).toBe(false);
    // A non-`hct_` token belongs to another provider (admin key, OIDC bearer);
    // this one declines rather than doing a pointless store read.
    expect((await service.authenticateToken('some-admin-key')).success).toBe(false);
  });

  test('re-minting invalidates the previous token', async () => {
    // A re-deploy that narrows the consented contracts must not leave the older,
    // wider credential usable.
    const first = await service.mint('backrest-1234', ['backup@1']);
    const second = await service.mint('backrest-1234', ['backup@1']);

    expect(second).not.toBe(first);
    expect((await service.authenticateToken(first)).success).toBe(false);
    expect((await service.authenticateToken(second)).success).toBe(true);
  });

  test('revoke kills the token; other deployments are untouched', async () => {
    const backrest = await service.mint('backrest-1234', ['backup@1']);
    const other = await service.mint('other-5678', ['backup@1']);

    await service.revoke('backrest-1234');

    expect((await service.authenticateToken(backrest)).success).toBe(false);
    expect((await service.authenticateToken(other)).success).toBe(true);
  });

  test('stores the token hashed, never in plaintext', async () => {
    // The server only needs to recognize a token presented back to it. Keeping the
    // plaintext would mean a copy of the data dir hands over live credentials for
    // every provider app.
    const token = await service.mint('backrest-1234', ['backup@1']);
    const raw = await storage.readFileAsString('config/contract-tokens.json');

    expect(raw).not.toContain(token);
    expect(JSON.parse(raw).tokens[0].hash).toMatch(/^[a-f0-9]{64}$/);
  });

  test('an unknown contract ref contributes no capability', async () => {
    // Forward-compat: a token minted by a newer server for a contract this build
    // doesn't know grants nothing here, rather than a capability nothing checks.
    const token = await service.mint('future-app', ['telemetry@1']);
    expect((await service.authenticateToken(token)).principal?.capabilities).toEqual([]);
  });
});
