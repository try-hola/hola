import { HolaSdk } from '@hola/sdk';
import React from 'react';
import { render, Text, Box } from 'ink';

type DevOpts = {
  path?: string;
  appId?: string;
  version?: string;
  watch?: string;
  traefik?: boolean;
  noDeploy?: boolean;
  noStream?: boolean;
};

export async function runBundleDev(opts: DevOpts) {
  const ui = render(<Text color="cyan">Starting dev session...</Text>);
  try {
    const sdk = new HolaSdk();
  const cfg = await sdk.system.config();
  const ff: Record<string, boolean> = (cfg && typeof cfg === 'object' && 'featureFlags' in cfg ? (cfg as { featureFlags: Record<string, boolean> }).featureFlags : {}) || {};
    const devEnabled = Boolean(ff.HOLA_ENABLE_DEV_API || ff.enableDevApi);
    if (!devEnabled) {
      ui.rerender(
        <Box flexDirection="column">
          <Text color="yellow">Developer endpoints are disabled on the server.</Text>
          <Text>Enable with HOLA_ENABLE_DEV_API=true and restart the server, or fall back to the standard draft/deploy flow.</Text>
        </Box>
      );
      ui.unmount();
      return;
    }

    const appId = opts.appId ?? 'app-dev';
    const version = opts.version ?? 'dev';
    const session = await sdk.dev.sessions.create({ appId, version });
    ui.rerender(
      <Box flexDirection="column">
        <Text color="green">Dev session created</Text>
        <Text>sessionId: {session.sessionId}</Text>
        <Text>draftId: {session.draftId}</Text>
        <Text>path: {opts.path ?? process.cwd()}</Text>
        <Text color="gray">Next: implement file sync and auto-validate/redeploy.</Text>
      </Box>
    );

    if (!opts.noDeploy) {
      try {
        const res = await sdk.dev.sessions.deploy(session.id, { stream: !opts.noStream });
        ui.rerender(
          <Box flexDirection="column">
            <Text color="green">Deploy triggered</Text>
            <Text>jobId: {res.jobId ?? 'n/a'}</Text>
            <Text>releaseId: {res.releaseId ?? 'n/a'}</Text>
            <Text color="gray">Streaming not implemented yet. Use jobs/logs watchers when available.</Text>
          </Box>
        );
      } catch (err) {
        ui.rerender(<Text color="red">Deploy failed: {(err as Error)?.message}</Text>);
      }
    }
  } catch (e) {
    render(<Text color="red">Error: {(e as Error).message}</Text>);
  } finally {
    ui.unmount();
  }
}
