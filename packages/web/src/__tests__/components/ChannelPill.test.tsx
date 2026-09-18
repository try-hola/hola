import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChannelPill, pillFor } from '../../components/ui/ChannelPill';

describe('pillFor', () => {
  it('build wins over follows', () => {
    expect(pillFor({ channel: 'beta', versionChannel: 'rc' })).toEqual({
      channel: 'rc',
      kind: 'build',
    });
  });

  it('returns null when both channel and versionChannel are stable', () => {
    expect(pillFor({ channel: 'stable', versionChannel: 'stable' })).toBeNull();
  });

  it('falls back to follows when the build channel is unknown', () => {
    expect(pillFor({ channel: 'beta', versionChannel: undefined })).toEqual({
      channel: 'beta',
      kind: 'follows',
    });
  });

  it('returns null when neither channel is set', () => {
    expect(pillFor({})).toBeNull();
  });
});

describe('ChannelPill', () => {
  it('titles a follows pill', () => {
    render(<ChannelPill channel="beta" kind="follows" />);
    expect(screen.getByText('beta')).toHaveAttribute('title', 'Follows the beta channel');
  });

  it('titles a build pill', () => {
    render(<ChannelPill channel="rc" kind="build" />);
    expect(screen.getByText('rc')).toHaveAttribute('title', 'Running a rc build');
  });

  it('titles a published pill', () => {
    render(<ChannelPill channel="beta, rc" kind="published" />);
    expect(screen.getByText('beta, rc')).toHaveAttribute('title', 'Also published on beta, rc');
  });
});
