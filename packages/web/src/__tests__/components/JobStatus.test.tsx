import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { JobStatus } from '../../components/JobStatus';
import type { Job } from '@hola/shared';

function createJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    type: 'install',
    status: 'running',
    startedAt: new Date().toISOString(),
    progress: 42,
    deploymentId: 'deployment-1',
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe('JobStatus', () => {
  it('renders running job with progress', () => {
    const job = createJob({ status: 'running', progress: 42 });
    render(<JobStatus job={job} size="md" />);
    
    expect(screen.getByText(/42%/i)).toBeInTheDocument();
    expect(screen.getByText(/running/i)).toBeInTheDocument();
  });

  it('renders completed job without progress', () => {
    const job = createJob({ status: 'completed', progress: 100 });
    render(<JobStatus job={job} size="md" />);
    
    expect(screen.getByText(/completed/i)).toBeInTheDocument();
    // Progress should not be shown for completed jobs
    expect(screen.queryByText(/100%/i)).not.toBeInTheDocument();
  });

  it('renders failed job with proper styling', () => {
    const job = createJob({ status: 'failed' });
    render(<JobStatus job={job} size="md" />);
    
    expect(screen.getByText(/failed/i)).toBeInTheDocument();
    // Check for danger color class
    const element = screen.getByText(/failed/i);
    expect(element.className).toContain('text-danger');
  });

  it('renders different sizes correctly', () => {
    const job = createJob();
    const { unmount } = render(<JobStatus job={job} size="sm" />);
    
    // Should render without throwing
    expect(screen.getAllByText(/install/i)).toHaveLength(1);
    unmount();
    
    render(<JobStatus job={job} size="lg" />);
    expect(screen.getAllByText(/install/i)).toHaveLength(1);
  });

  it('displays job type correctly', () => {
    const deployJob = createJob({ type: 'install' });
    render(<JobStatus job={deployJob} size="md" />);
    expect(screen.getAllByText(/install/i)).toHaveLength(1);
  });
});
