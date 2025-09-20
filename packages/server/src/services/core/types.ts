/**
 * Service interfaces and types
 * 
 * Shared interfaces for service health checking and monitoring
 */

export interface ServiceHealth {
  healthy: boolean;
  lastCheck: Date;
  error?: string;
}

export interface HealthCheckable {
  healthCheck(): Promise<ServiceHealth>;
}