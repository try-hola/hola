import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UpdateAvailableBanner } from '../../components/UpdateAvailableBanner';
import type { UpdateCheckResult } from '@hola/shared';

const updateCheck = vi.fn();
vi.mock('../../utils/api-hybrid', () => ({
  api: { system: { updateCheck: () => updateCheck() } },
}));

function mockResult(result: UpdateCheckResult) {
  updateCheck.mockResolvedValue(result);
}

describe('UpdateAvailableBanner', () => {
  beforeEach(() => {
    updateCheck.mockReset();
  });

  it('renders nothing when no update is available', async () => {
    mockResult({ current: '1.0.0', latest: '1.0.0', updateAvailable: false, releaseUrl: null });
    const { container } = render(<UpdateAvailableBanner />);
    // Allow the mount-effect fetch to resolve.
    await Promise.resolve();
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when the update-check request fails', async () => {
    updateCheck.mockRejectedValue(new Error('offline'));
    const { container } = render(<UpdateAvailableBanner />);
    await Promise.resolve();
    expect(container.firstChild).toBeNull();
  });

  it('shows versions and a release link when an update is available', async () => {
    mockResult({
      current: '1.0.0',
      latest: '1.2.0',
      updateAvailable: true,
      releaseUrl: 'https://example.com/releases/1.2.0',
    });
    render(<UpdateAvailableBanner />);

    expect(await screen.findByText(/Hola 1\.2\.0/)).toBeInTheDocument();
    expect(screen.getByText('1.0.0')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /View release/ });
    expect(link).toHaveAttribute('href', 'https://example.com/releases/1.2.0');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('hides after the dismiss button is clicked', async () => {
    mockResult({ current: '1.0.0', latest: '1.2.0', updateAvailable: true, releaseUrl: null });
    render(<UpdateAvailableBanner />);

    const dismiss = await screen.findByLabelText('Dismiss update notification');
    fireEvent.click(dismiss);
    expect(screen.queryByText(/Hola 1\.2\.0/)).not.toBeInTheDocument();
  });
});
