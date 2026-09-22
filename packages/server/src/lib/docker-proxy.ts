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
 *
 * **The envelope is a property of the responses, not of the route table
 * (F08).** Allowing a path is only half a decision — the other half is what
 * comes back through it. `/containers/json` and `/events` were allowed and then
 * forwarded verbatim, so they returned the command lines, bind sources and
 * network topology that `/containers/{id}/json` was rebuilt field-by-field to
 * withhold, and the inspect allowlist bought nothing an attacker could not
 * route around by asking a different way. Every endpoint that can carry those
 * categories is now rebuilt from an allowlist — `redactContainerList`,
 * `redactInspect`, `redactInfo` — and the one streamed endpoint that can
 * (`/events`) is filtered payload by payload (`redactEventStream`).
 */

/** What the proxy does with a request it allows. */
export type ProxyDecision =
  | { allow: true; kind: 'passthrough' | 'inspect' | 'info' | 'list' | 'events' | 'stream' }
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
  if (pathname === '/containers/json') return { allow: true, kind: 'list' };
  if (pathname === '/events') return { allow: true, kind: 'events' };
  if (INSPECT_RE.test(pathname)) return { allow: true, kind: 'inspect' };
  if (LOGS_RE.test(pathname)) return { allow: true, kind: 'stream' };

  return { allow: false };
}

/**
 * Labels are the one open namespace the grant deliberately keeps (F08).
 *
 * They are also the only thing that makes the contract work without per-app
 * configuration: `applyPlatformDefaults` stamps `sh.hola.app`,
 * `sh.hola.deployment` and `sh.hola.name` on every container precisely so a
 * collector can group logs by app, and Compose's own `com.docker.compose.*`
 * labels are how any standard Docker client groups a project. An *allowlist*
 * over label keys would therefore break the capability it is meant to protect,
 * and would break it for app-authored labels nobody can enumerate in advance.
 *
 * So labels are filtered by a narrow **denylist** instead, aimed at exactly the
 * category the rest of this module denies: absolute host paths. Docker Compose
 * records the host-side compose file and project directory as labels on every
 * container it creates, which hands a collector the same host paths that
 * `Mounts` and `HostConfig.Binds` are emptied to withhold; Docker Desktop
 * encodes bind sources under `desktop.docker.io/binds/`. Nothing else here is
 * withheld — a label an app's own image author wrote is the app's business.
 */
const DENIED_LABEL_KEYS = new Set([
  'com.docker.compose.project.config_files',
  'com.docker.compose.project.working_dir',
]);
const DENIED_LABEL_PREFIXES = ['desktop.docker.io/binds/'];

function labelDenied(key: string): boolean {
  return DENIED_LABEL_KEYS.has(key) || DENIED_LABEL_PREFIXES.some((p) => key.startsWith(p));
}

/**
 * Drop the host-path-bearing keys from a label map, preserving everything else
 * (and the map's identity when nothing is denied). A non-object is returned
 * untouched — this runs over daemon-shaped data, not validated input.
 */
export function redactLabels(labels: unknown): unknown {
  if (!labels || typeof labels !== 'object' || Array.isArray(labels)) return labels;
  const entries = Object.entries(labels as Record<string, unknown>);
  if (!entries.some(([k]) => labelDenied(k))) return labels;
  return Object.fromEntries(entries.filter(([k]) => !labelDenied(k)));
}

/**
 * Rebuild a `GET /containers/json` entry from an explicit field allowlist —
 * the list-endpoint half of the same rule `redactInspect` applies (F08).
 *
 * This endpoint used to pass through byte-identical, which made the inspect
 * redaction decorative: Docker's *list* response carries the same categories
 * inspect deliberately strips, under different names and shapes, so a collector
 * that was denied a container's command line, bind sources and network topology
 * could simply ask for all containers and read them there instead.
 *
 * The vocabulary is inspect's; only the spelling differs. Field by field:
 *
 * | list                 | inspect                      | decision |
 * | -------------------- | ---------------------------- | -------- |
 * | `Command` (a string) | `Config.Cmd`/`.Entrypoint`   | denied — this is where a credential passed on the command line shows up |
 * | `Ports`              | `HostConfig.PortBindings`    | emptied  |
 * | `Mounts`             | `Mounts`                     | emptied — host bind sources |
 * | `NetworkSettings`    | `NetworkSettings`            | emptied — network topology |
 * | `HostConfig`         | `HostConfig`                 | emptied  |
 * | `Labels`             | `Config.Labels`              | kept, minus host paths (see `redactLabels`) |
 * | `Id`/`Names`/`Image` | `Id`/`Name`/`Image`          | kept — "know what exists" |
 * | `State`/`Status`     | `State`                      | kept — a collector shows running/exited |
 *
 * Denied-but-structural fields are emitted **present and empty** rather than
 * dropped, for the same reason `redactInspect` does it: a real daemon always
 * returns them, so clients walk them without nil checks, and dropping the field
 * denies the client rather than the data. `Command` is a plain string, so its
 * empty form is `''` — which is also exactly what Docker's Go SDK decodes an
 * absent `Command` into, so a client cannot tell the two apart.
 */
export function redactContainerListEntry(entry: unknown): unknown {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
  const c = entry as Record<string, unknown>;
  return {
    Id: c.Id,
    Names: c.Names,
    Image: c.Image,
    ImageID: c.ImageID,
    Created: c.Created,
    State: c.State,
    Status: c.Status,
    Labels: redactLabels(c.Labels),
    Command: '',
    Ports: [],
    Mounts: [],
    HostConfig: {},
    NetworkSettings: { Networks: {} },
  };
}

/** Apply `redactContainerListEntry` across a `GET /containers/json` body. */
export function redactContainerList(body: unknown): unknown {
  if (!Array.isArray(body)) return body;
  return body.map(redactContainerListEntry);
}

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

/**
 * Rebuild a `/containers/{id}/json` response from an explicit field
 * allowlist. Everything else — `Config.Env`, `Config.Cmd`, `Config.Entrypoint`,
 * `HostConfig`, `Mounts`, `NetworkSettings` — is dropped, because it either
 * carries secrets (env) or grants more than "read logs, know what exists"
 * (host config, mounts, network internals).
 *
 * `Config.Labels` survives (the collector groups by them) but goes through
 * `redactLabels` first: Compose stamps absolute host paths into labels, which
 * would otherwise walk straight past the emptied `Mounts` (F08).
 */
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
      Labels: redactLabels(config.Labels),
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

/**
 * Redact one decoded `/events` payload (F08).
 *
 * The review that produced F08 asked what events disclose beyond list and
 * inspect. The answer is `Actor.Attributes`: for a container event Docker
 * populates it with the container's `image`, `name` **and its entire label
 * map** — so every host path Compose writes into a label arrives here even
 * with list and inspect locked down. Everything else an event carries
 * (`Type`, `Action`/`status`, `id`, `from`, `scope`, `time`, `timeNano`) is
 * what a collector actually consumes to know a container appeared or went
 * away, and is kept untouched.
 *
 * Note what is deliberately **not** withheld: the app inventory. `sh.hola.app`
 * and the Compose project/service labels stay, here as in list and inspect,
 * because "know what exists, and read its logs" *is* the envelope this grant
 * describes — and because those labels are what let a collector group logs by
 * app with no per-app configuration. Withholding them would not close a hole
 * (list already discloses the same set, legitimately); it would only break the
 * contract's stated purpose.
 */
export function redactEvent(event: unknown): unknown {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return event;
  const e = event as Record<string, unknown>;
  const actor = e.Actor;
  if (!actor || typeof actor !== 'object' || Array.isArray(actor)) return event;
  const a = actor as Record<string, unknown>;
  const attributes = redactLabels(a.Attributes);
  if (attributes === a.Attributes) return event;
  return { ...e, Actor: { ...a, Attributes: attributes } };
}

/**
 * Wrap Docker's newline-delimited `/events` stream so every payload goes
 * through `redactEvent` on its way out.
 *
 * Two properties this must not lose, both already under test: the stream stays
 * a *stream* (each complete line is re-emitted as it arrives, never buffered to
 * completion — a collector watching for container starts must see them live),
 * and an arbitrarily long idle gap is not an error (dockerd holds a quiet event
 * watch open for minutes).
 *
 * A line that is not parseable JSON is **dropped**, not forwarded. The proxy's
 * whole job is to be the thing that decides what leaves the socket; a payload
 * it cannot parse is a payload it cannot redact, and forwarding it would make
 * "unparseable" the way around the filter.
 */
export function redactEventStream(body: ReadableStream<Uint8Array> | null): ReadableStream<Uint8Array> | null {
  if (!body) return body;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';

  const emit = (line: string, controller: TransformStreamDefaultController<Uint8Array>): void => {
    if (line.trim() === '') return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      console.error('[docker-proxy] dropped an unparseable /events line');
      return;
    }
    controller.enqueue(encoder.encode(`${JSON.stringify(redactEvent(parsed))}\n`));
  };

  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        let newline = buffer.indexOf('\n');
        while (newline !== -1) {
          emit(buffer.slice(0, newline), controller);
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf('\n');
        }
      },
      flush(controller) {
        buffer += decoder.decode();
        emit(buffer, controller);
        buffer = '';
      },
    }),
  );
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
      if (decision.kind === 'inspect' || decision.kind === 'list') {
        let body: unknown;
        try {
          body = await upstream.json();
        } catch {
          body = null;
        }
        const redacted = decision.kind === 'list' ? redactContainerList(body) : redactInspect(body);
        return new Response(JSON.stringify(redacted), {
          status: upstream.status,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (decision.kind === 'events') {
        // Re-wrap rather than forward: each NDJSON payload is redacted in
        // flight (F08). The upstream headers are reused minus `content-length`,
        // which no longer describes the body we are producing — dockerd streams
        // events chunked, so in practice there is none to drop.
        const headers = new Headers(upstream.headers);
        headers.delete('content-length');
        return new Response(redactEventStream(upstream.body), { status: upstream.status, headers });
      }

      // passthrough / stream: forward the upstream response as-is, body included
      // (Bun streams it), so `/_ping`, `/version` and `/containers/{id}/logs`
      // reach the caller byte-identical.
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
