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
import { RealContractTokenService, createContractTokenAuthProvider, contractCapability } from '../../services/auth/contract-tokens';
import { authorizeRequest, getRequiredCapability, isContractScoped } from '../../middleware/auth';
import type { Principal } from '../../services/auth/auth-service';

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
    // The Phase 4 read side is an ordinary authenticated GET, like every other
    // dashboard read: it discloses the installed app set and who covers what, which
    // any signed-in operator can already see on the Apps page.
    expect(getRequiredCapability('/api/contracts', 'GET')).toBeNull();
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

  test('container-logs@1 is provisioned, not brokered: its capability matches no route (spec 004 FR-026)', () => {
    // The broker routes stay backup@1-only (research.md): a provisioned contract
    // needs no broker endpoints, so even though `contractCapability` resolves a
    // capability name for it, nothing in the auth middleware's route table ever
    // requires it — unlike backup@1's real broker route.
    expect(contractCapability('container-logs@1')).toBe('contract:container-logs');
    expect(getRequiredCapability('/api/contracts/backup/prepare', 'POST')).toBe('contract:backup');
    // No pattern in the table matches a container-logs broker path (there is no
    // such route), so a POST there falls through to the generic default rather
    // than the contract-scoped capability nothing would ever check.
    expect(getRequiredCapability('/api/contracts/container-logs/prepare', 'POST')).not.toBe('contract:container-logs');
  });

  // ADR 0004 §6 says the token is "not usable elsewhere in the API", and the
  // file's own docstring claimed "every other route rejects the token, including
  // reads of other apps' data". Neither was true: the capability table names
  // capabilities only for MUTATING routes, so every GET required none, and the
  // middleware only enforced when one was named. A credential minted for one
  // POST could read the whole host.
  describe('a contract token is closed by default (#471)', () => {
    const contractPrincipal: Principal = {
      id: 'contract:backrest-1234',
      type: 'service',
      name: 'Contract provider backrest-1234',
      roles: [],
      capabilities: ['contract:backup'],
    };
    const operator: Principal = {
      id: 'admin',
      type: 'user',
      name: 'Operator',
      roles: ['admin'],
      capabilities: ['*'],
    };
    // Mirrors ApiKeyAuthProvider: a wildcard holds everything, otherwise exact.
    const has = (principal: Principal, capability: string) =>
      principal.capabilities.includes('*') || principal.capabilities.includes(capability);

    test('recognises the contract principal, and only it', () => {
      expect(isContractScoped(contractPrincipal)).toBe(true);
      expect(isContractScoped(operator)).toBe(false);
      // A principal that merely ALSO holds a contract capability is an operator,
      // not a contract token, and must keep its ordinary read access.
      expect(isContractScoped({ ...operator, capabilities: ['contract:backup', 'write:deployments'] })).toBe(false);
      // No capabilities at all is not a contract token either — it is a
      // principal with nothing, which the ordinary rules already handle.
      expect(isContractScoped({ ...operator, capabilities: [] })).toBe(false);
    });

    test('may call its own broker route', () => {
      const route = getRequiredCapability('/api/contracts/backup/prepare', 'POST');
      expect(authorizeRequest(contractPrincipal, route, has)).toBe('allow');
    });

    test.each([
      // Every one of these was reachable before: an unauthenticated-for-reads
      // route table plus a credential handed to a catalog container.
      ['/api/deployments', 'GET'],
      ['/api/deployments/other-app/logs', 'GET'],
      ['/api/settings', 'GET'],
      ['/api/jobs/abc', 'GET'],
      ['/api/catalog', 'GET'],
      ['/api/contracts', 'GET'],
    ])('is refused %s %s, a read no capability guards', (path, method) => {
      const route = getRequiredCapability(path, method);
      expect(route).toBeNull(); // the precondition that made this reachable
      expect(authorizeRequest(contractPrincipal, route, has)).toBe('outside-contract');
    });

    test('is refused a write it has no capability for', () => {
      const route = getRequiredCapability('/api/deployments', 'POST');
      expect(authorizeRequest(contractPrincipal, route, has)).toBe('outside-contract');
    });

    test('a token for a provisioned contract can reach nothing at all', async () => {
      // container-logs@1 has no broker route, so its capability guards nothing —
      // which used to mean "reads everything", and now means "reaches nothing".
      const token = await service.mint('dozzle-1', ['container-logs@1']);
      const principal = (await service.authenticateToken(token)).principal!;
      expect(principal.capabilities).toEqual(['contract:container-logs']);
      for (const [path, method] of [['/api/deployments', 'GET'], ['/api/contracts/backup/prepare', 'POST']] as const) {
        expect(authorizeRequest(principal, getRequiredCapability(path, method), has)).toBe('outside-contract');
      }
    });

    test('the operator is untouched: reads stay open, writes still checked', () => {
      expect(authorizeRequest(operator, getRequiredCapability('/api/deployments', 'GET'), has)).toBe('allow');
      expect(authorizeRequest(operator, getRequiredCapability('/api/deployments', 'POST'), has)).toBe('allow');

      const readOnly: Principal = { ...operator, capabilities: ['read:deployments'] };
      expect(authorizeRequest(readOnly, getRequiredCapability('/api/deployments', 'GET'), has)).toBe('allow');
      expect(authorizeRequest(readOnly, getRequiredCapability('/api/deployments', 'POST'), has)).toBe('missing-capability');
    });
  });
});
