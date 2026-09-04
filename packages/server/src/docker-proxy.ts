/**
 * Entrypoint for the container-logs proxy sidecar (spec 004, ADR 0004 §12).
 *
 * Run as `hola-docker-proxy`'s `command` from the server's own image (see
 * `injectContainerLogsSource` in `services/core/compose-mounts.ts`) — the same
 * image the server itself runs from, so it already has the socket-group access
 * the server needs and needs no separate published artefact. All the actual
 * decision/redaction logic lives in `lib/docker-proxy.ts`, tested hermetically
 * against a fake Docker API; this file is just process wiring.
 */
import { startDockerProxy } from './lib/docker-proxy';

const socketPath = process.env.DOCKER_SOCKET?.trim() || '/var/run/docker.sock';
const port = Number(process.env.PORT?.trim() || '2375');

const handle = await startDockerProxy({ socketPath, port });
console.log(`[docker-proxy] listening on :${handle.port}, forwarding to ${socketPath}`);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[docker-proxy] received ${signal}, shutting down`);
  await handle.stop();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
