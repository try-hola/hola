/**
 * The container-logs read-only Docker API proxy (spec 004, ADR 0004 §12).
 *
 * Pure request-shaping logic (`decide`, `redactInspect`) plus the Bun server
 * that wires it to a real Docker socket (`startDockerProxy`). No server-package
 * imports — this module is deliberately hermetic so it can be unit-tested
 * against a fake Docker API on a temp unix socket with no other Hola service
 * running.
 *
 * The envelope (FR-023): a granted collector may list containers, read a
 * redacted inspect (no environment variables, no host config, no mounts),
 * stream logs, and watch events. It may not start, stop, create, exec into or
 * delete a container, copy files out of one, or read its environment. Neither
 * a read-only bind of the socket (the mode bit doesn't restrict the Docker
 * API) nor a read-only mount of the docker log directory (leaks every
 * container's `Config.Env` via `config.v2.json`) meets that; this allowlisting
 * proxy is the smallest thing that does.
 */

/** What the proxy does with a request it allows. */
export type ProxyDecision =
  | { allow: true; kind: 'passthrough' | 'inspect' | 'info' | 'stream' }
  | { allow: false };

const VERSION_PREFIX_RE = /^\/v\d+(?:\.\d+)*(?=\/|$)/;
const INSPECT_RE = /^\/containers\/[^/]+\/json$/;
const LOGS_RE = /^\/containers\/[^/]+\/logs$/;

/**
 * Decide whether a request is permitted by the container-logs grant, and how
 * to handle it. An optional `/vN.NN` API-version prefix is stripped before
 * matching (accepted and forwarded unchanged) — Docker clients routinely pin
 * one.
 *
 * `GET` and `HEAD` are allowed; every other verb can mutate or destroy state,
 * which the grant never permits. HEAD earns its place by being strictly less
 * revealing than the GET of the same path — it returns headers and no body —
 * and by being unavoidable: Docker's own client pings with `HEAD /_ping`
 * before anything else, so a GET-only allowlist refuses every standard client
 * on its first call and looks to the caller like no engine at all.
 */
export function decide(method: string, path: string): ProxyDecision {
  const verb = method.toUpperCase();
  if (verb !== 'GET' && verb !== 'HEAD') return { allow: false };

  const withoutVersion = path.replace(VERSION_PREFIX_RE, '') || '/';
  const pathname = withoutVersion.split('?')[0] ?? withoutVersion;

  if (pathname === '/_ping' || pathname === '/version') return { allow: true, kind: 'passthrough' };
  if (pathname === '/info') return { allow: true, kind: 'info' };
  if (pathname === '/containers/json') return { allow: true, kind: 'passthrough' };
  if (pathname === '/events') return { allow: true, kind: 'stream' };
  if (INSPECT_RE.test(pathname)) return { allow: true, kind: 'inspect' };
  if (LOGS_RE.test(pathname)) return { allow: true, kind: 'stream' };

  return { allow: false };
}

/**
 * Rebuild a `/containers/{id}/json` response from an explicit field
 * allowlist. Everything else — `Config.Env`, `Config.Cmd`, `Config.Entrypoint`,
 * `HostConfig`, `Mounts`, `NetworkSettings` — is dropped, because it either
 * carries secrets (env) or grants more than "read logs, know what exists"
 * (host config, mounts, network internals).
 */
/**
 * Rebuild `GET /info` from an allowlist, the same way inspect is.
 *
 * A client on Docker's official SDK calls this to decide an engine is really
 * there — Dozzle reports "Could not connect to any Docker Engine" and exits
 * without it — so refusing it outright means the grant cannot serve the
 * clients it exists for. The raw response is far too generous though: it
 * carries `RegistryConfig`, `Labels`, `Plugins`, `DockerRootDir`,
 * `SecurityOptions`, Swarm membership and, worst of all, `HttpProxy` /
 * `HttpsProxy`, which routinely embed credentials.
 *
 * What survives is what identifies the engine and sizes it: enough for a
 * collector to label its connection and show a host, and nothing that
 * describes how the host is configured or what it can reach.
 */
export function redactInfo(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body;
  const b = body as Record<string, unknown>;
  return {
    ID: b.ID,
    Name: b.Name,
    ServerVersion: b.ServerVersion,
    OSType: b.OSType,
    OperatingSystem: b.OperatingSystem,
    Architecture: b.Architecture,
    NCPU: b.NCPU,
    MemTotal: b.MemTotal,
    Containers: b.Containers,
    ContainersRunning: b.ContainersRunning,
    ContainersPaused: b.ContainersPaused,
    ContainersStopped: b.ContainersStopped,
    Images: b.Images,
  };
}

export function redactInspect(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body;
  const b = body as Record<string, unknown>;
  const rawConfig = b.Config;
  const config = rawConfig && typeof rawConfig === 'object' ? (rawConfig as Record<string, unknown>) : {};

  return {
    Id: b.Id,
    Name: b.Name,
    Created: b.Created,
    State: b.State,
    Image: b.Image,
    Config: {
      Tty: config.Tty,
      Labels: config.Labels,
      Image: config.Image,
      Hostname: config.Hostname,
    },
    // Present but empty, rather than absent. A real daemon always returns these,
    // so a client walks them without checking — Dozzle segfaults on
    // `HostConfig.PortBindings` when HostConfig is missing, and it is not alone:
    // anything built on Docker's SDK assumes the shape. Dropping the field
    // therefore doesn't deny the data, it denies the client. Empty containers
    // keep the response shape-compatible while disclosing nothing: no host port
    // map, no bind sources, no network topology. The grant is about logs.
    HostConfig: { PortBindings: {} },
    Mounts: [],
    NetworkSettings: { Networks: {} },
  };
}

const DENIED_MESSAGE = { message: 'not permitted by the container-logs grant' };

export interface DockerProxyHandle {
  port: number;
  stop(): Promise<void>;
}

/**
 * Start the proxy: a Bun HTTP server that forwards allowed requests to the
 * Docker API over `socketPath`, redacting `/containers/{id}/json` and denying
 * everything else with `403`. `port: 0` binds an ephemeral port (tests read it
 * back off the returned handle); a caller wanting a fixed port passes one.
 */
export async function startDockerProxy(opts: {
  socketPath: string;
  port: number;
  hostname?: string;
}): Promise<DockerProxyHandle> {
  const server = Bun.serve({
    port: opts.port,
    hostname: opts.hostname,
    // `/events` and a `follow`ed log stream are long-lived and routinely idle —
    // a quiet app logs nothing for minutes. Bun.serve's default 10s idleTimeout
    // would close those connections out from under the collector, so it is
    // disabled here. Safe: the allowlist admits only reads, and the proxy is
    // reachable on the provider's own compose network alone.
    idleTimeout: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const decision = decide(req.method, url.pathname);

      if (!decision.allow) {
        console.error(`[docker-proxy] denied: ${req.method} ${url.pathname}`);
        return new Response(JSON.stringify(DENIED_MESSAGE), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        });
      }

      const upstreamUrl = `http://docker${url.pathname}${url.search}`;
      let upstream: Response;
      try {
        upstream = await fetch(upstreamUrl, {
          method: req.method,
          unix: opts.socketPath,
          // Tie the upstream request to the caller's connection: a collector
          // that drops a `follow`ed log stream (restart, config reload) would
          // otherwise leave its socket request open here, and a sidecar that
          // lives for weeks would leak a descriptor per reconnect.
          signal: req.signal,
        } as RequestInit & { unix: string });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[docker-proxy] upstream error: ${message}`);
        return new Response(JSON.stringify({ message: 'container-logs proxy could not reach the Docker socket' }), {
          status: 502,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (decision.kind === 'info') {
        const raw = await upstream.json().catch(() => undefined);
        return new Response(JSON.stringify(redactInfo(raw)), {
          status: upstream.status,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (decision.kind === 'inspect') {
        let body: unknown;
        try {
          body = await upstream.json();
        } catch {
          body = null;
        }
        return new Response(JSON.stringify(redactInspect(body)), {
          status: upstream.status,
          headers: { 'content-type': 'application/json' },
        });
      }

      // passthrough / stream: forward the upstream response as-is, body included
      // (Bun streams it), so `/containers/json`, `/containers/{id}/logs` and
      // `/events` reach the caller byte-identical.
      return new Response(upstream.body, { status: upstream.status, headers: upstream.headers });
    },
  });

  return {
    port: server.port ?? opts.port,
    async stop() {
      server.stop(true);
    },
  };
}
