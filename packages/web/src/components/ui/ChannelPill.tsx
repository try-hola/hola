import React from 'react';
import { STABLE_CHANNEL } from '@hola/shared';

export type ChannelPillKind = 'follows' | 'build' | 'published';

const TITLE_BY_KIND: Record<ChannelPillKind, (channel: string) => string> = {
  follows: (channel) => `Follows the ${channel} channel`,
  build: (channel) => `Running a ${channel} build`,
  published: (channel) => `Also published on ${channel}`,
};

/** A small neutral pill naming a release channel (#428). */
export const ChannelPill: React.FC<{ channel: string; kind: ChannelPillKind }> = ({ channel, kind }) => (
  <span
    title={TITLE_BY_KIND[kind](channel)}
    className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-surface-2 text-text-muted text-[10.5px] font-semibold whitespace-nowrap flex-none"
  >
    {channel}
  </span>
);

/**
 * Picks the channel pill (if any) for a deployment: the running build's channel
 * wins when known and non-stable, else the followed channel when non-stable,
 * else no pill.
 */
export function pillFor({
  channel,
  versionChannel,
}: {
  channel?: string;
  versionChannel?: string;
}): { channel: string; kind: 'follows' | 'build' } | null {
  if (versionChannel && versionChannel !== STABLE_CHANNEL) {
    return { channel: versionChannel, kind: 'build' };
  }
  if (channel && channel !== STABLE_CHANNEL) {
    return { channel, kind: 'follows' };
  }
  return null;
}
