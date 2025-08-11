// Global cache shared across all components for API data
export const globalCache = new Map<string, { data: unknown; timestamp: number }>();
