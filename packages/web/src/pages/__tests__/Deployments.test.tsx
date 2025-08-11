import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { Deployments } from '../Deployments';
import { API } from '@hola/shared';
import type { GetDeploymentsResponse, DeploymentListItem } from '@hola/shared';

const mockDeployments: DeploymentListItem[] = [
  {
    id: 'nextcloud-prod',
    name: 'Nextcloud',
    app: 'nextcloud',
    icon: '☁️',
    status: 'running',
    uptime: '15 days',
    version: '28.0.2',
    resources: { cpu: '12%', memory: '256MB' },
    ports: ['8080:80', '8443:443'],
    lastUpdated: '2 days ago',
    url: 'https://nextcloud.local'
  },
  {
    id: 'grafana-monitoring',
    name: 'Grafana',
    app: 'grafana',
    icon: '📊',
    status: 'stopped',
    uptime: '0 days',
    version: '10.3.1',
    resources: { cpu: '0%', memory: '0MB' },
    ports: ['3000:3000'],
    lastUpdated: '1 hour ago',
    url: 'https://grafana.local'
  }
];

const originalFetch = global.fetch;

function setupMockFetch(response: GetDeploymentsResponse) {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes(API.deployments.base)) {
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('Not Found', { status: 404 });
  }) as typeof fetch;
}

function setupMockFetchError() {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes(API.deployments.base)) {
      return new Response(JSON.stringify({ 
        error: { 
          code: 'PERMISSION_DENIED', 
          message: 'Permission denied' 
        } 
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('Not Found', { status: 404 });
  }) as typeof fetch;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  global.fetch = originalFetch;
});

const DeploymentsWithRouter = () => (
  <MemoryRouter>
    <Deployments />
  </MemoryRouter>
);

describe('Deployments', () => {
  it('renders deployments list when API call succeeds', async () => {
    // Set up a response with more items than the limit to trigger pagination
    setupMockFetch({
      items: mockDeployments,
      page: 1,
      limit: 1, // Set limit lower than number of items to show pagination
      total: 2
    });

    render(<DeploymentsWithRouter />);

    // Should show loading initially
    expect(screen.getByText(/loading/i)).toBeInTheDocument();

    // Wait for deployments to load
    await waitFor(() => {
      expect(screen.getByText('Nextcloud')).toBeInTheDocument();
      expect(screen.getByText('Grafana')).toBeInTheDocument();
    });

    // Should show pagination info when total > limit
    await waitFor(() => {
      expect(screen.getByText(/showing.*1.*to.*2.*of.*2.*deployments/i)).toBeInTheDocument();
    });
  });

  it('handles API error gracefully', async () => {
    setupMockFetchError();

    render(<DeploymentsWithRouter />);

    // Wait for error to be displayed
    await waitFor(() => {
      expect(screen.getByText(/permission denied/i)).toBeInTheDocument();
    });
  });

  it('displays deployment status correctly', async () => {
    setupMockFetch({
      items: mockDeployments,
      page: 1,
      limit: 10,
      total: 2
    });

    render(<DeploymentsWithRouter />);

    await waitFor(() => {
      // Check for running status in deployment cards (more specific selector)
      const deploymentCards = screen.getAllByText(/running/i).filter(el => 
        el.className.includes('bg-success/10')
      );
      expect(deploymentCards.length).toBeGreaterThan(0);
      
      // Check for stopped status
      expect(screen.getByText(/stopped/i)).toBeInTheDocument();
    });
  });

  it('shows empty state when no deployments', async () => {
    setupMockFetch({
      items: [],
      page: 1,
      limit: 10,
      total: 0
    });

    render(<DeploymentsWithRouter />);

    await waitFor(() => {
      expect(screen.getByText(/no deployments found/i)).toBeInTheDocument();
    });
  });

  it('uses shared API constants for fetch calls', async () => {
    setupMockFetch({
      items: mockDeployments,
      page: 1,
      limit: 10,
      total: 2
    });

    render(<DeploymentsWithRouter />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringMatching(new RegExp(`^${API.deployments.base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)),
        expect.any(Object)
      );
    });
  });
});
