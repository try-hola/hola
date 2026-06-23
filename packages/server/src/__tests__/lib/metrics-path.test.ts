/**
 * Metric path templating tests — bounds HTTP-metric label cardinality by
 * collapsing per-resource identifiers to placeholders.
 */
import { describe, it, expect } from 'bun:test';
import { templateMetricPath } from '../../lib/metrics';

describe('templateMetricPath', () => {
  it('collapses deployment ids, UUIDs, job ids, hex ids, and numbers', () => {
    expect(templateMetricPath('/api/deployments/gitea-3f9a2c7b')).toBe('/api/deployments/:id');
    expect(templateMetricPath('/api/drafts/2fb89ae5-ee38-4659-9b55-e4d422a74528/uploads')).toBe('/api/drafts/:id/uploads');
    expect(templateMetricPath('/api/jobs/job_1782253680249_9wewojfyyi6/logs')).toBe('/api/jobs/:id/logs');
    expect(templateMetricPath('/api/items/42')).toBe('/api/items/:n');
    expect(templateMetricPath('/api/x/deadbeefcafe123')).toBe('/api/x/:id');
  });

  it('leaves static route segments untouched', () => {
    expect(templateMetricPath('/api/deployments')).toBe('/api/deployments');
    expect(templateMetricPath('/api/system/status')).toBe('/api/system/status');
    expect(templateMetricPath('/api/auth/callback')).toBe('/api/auth/callback');
    expect(templateMetricPath('/api/health')).toBe('/api/health');
  });
});
