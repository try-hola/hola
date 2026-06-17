// Main exports and configuration for mock data
export * from './deployments';
export * from './jobs';
export * from './system';
export * from './notifications';
export * from './backups';
export * from './settings';
export * from './state-manager';

// Configuration for mock data behavior
export const config = {
  USE_MOCK_DATA: Bun.env.USE_MOCK_DATA !== 'false', // Default to true
  MOCK_JOB_SIMULATION: Bun.env.MOCK_JOB_SIMULATION !== 'false',
  MOCK_STATE_PERSISTENCE: Bun.env.MOCK_STATE_PERSISTENCE !== 'false',
  MOCK_REAL_TIME_UPDATES: Bun.env.MOCK_REAL_TIME_UPDATES !== 'false',
  JOB_SIMULATION_SPEED: Number(Bun.env.JOB_SIMULATION_SPEED) || 5, // seconds per 10% progress
};

console.log('[mock-data] Configuration:', config);
