/**
 * Mock Deployment Service Interface
 * 
 * Shared interface for testing deployment-related functionality.
 * Used across validation tests to maintain consistency.
 */

import type { GetDeploymentsRequest, GetDeploymentsResponse } from '@hola/shared';

export interface MockDeploymentService {
  listDeployments(request: GetDeploymentsRequest): Promise<GetDeploymentsResponse>;
}