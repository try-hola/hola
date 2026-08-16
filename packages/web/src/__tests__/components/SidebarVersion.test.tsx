import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SidebarVersion } from '../../components/layout/SidebarVersion';
import type { UpdateCheckResult } from '@hola/shared';

const updateCheck = vi.fn();
vi.mock('../../utils/api-hybrid', () => ({
  api: { system: { updateCheck: () => updateCheck() } },
}));

function renderVersion(isCollapsed = false) {
  return render(
    <MemoryRouter>
      <SidebarVersion isCollapsed={isCollapsed} />
    </MemoryRouter>,
  );
}

function mockResult(result: UpdateCheckResult) {
  updateCheck.mockResolvedValue(result);
}

describe('SidebarVersion', () => {
  beforeEach(() => {
    updateCheck.mockReset();
  });

  it('shows the running version and links to settings', async () => {
    mockResult({ current: '0.9.0', latest: '0.9.0', updateAvailable: false, releaseUrl: null });
    renderVersion();

    expect(await screen.findByText('v0.9.0')).toBeInTheDocument();
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/settings');
    expect(link).toHaveAttribute('title', 'Hola v0.9.0');
    expect(screen.queryByText('Update')).not.toBeInTheDocument();
  });

  it('flags an available update alongside the running version', async () => {
    mockResult({
      current: '0.9.0',
      latest: '1.0.0',
      updateAvailable: true,
      releaseUrl: 'https://example.com/releases/1.0.0',
    });
    renderVersion();

    expect(await screen.findByText('v0.9.0')).toBeInTheDocument();
    expect(screen.getByText('Update')).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute(
      'title',
      'Hola v0.9.0 — v1.0.0 is available',
    );
  });

  it('drops the "v" prefix and the label when collapsed', async () => {
    mockResult({ current: '0.9.0', latest: '0.9.0', updateAvailable: false, releaseUrl: null });
    renderVersion(true);

    expect(await screen.findByText('0.9.0')).toBeInTheDocument();
    expect(screen.queryByText('v0.9.0')).not.toBeInTheDocument();
  });

  it('renders nothing when the version is unknown', async () => {
    updateCheck.mockRejectedValue(new Error('offline'));
    const { container } = renderVersion();
    await Promise.resolve();
    expect(container.firstChild).toBeNull();
  });
});
