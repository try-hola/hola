/**
 * Compose Parser Tests
 * 
 * Tests compose.yaml parsing, merging defaults, and environment handling.
 */

import { describe, test, expect } from 'bun:test';
import { parseComposeDefaults, mergeDefaults } from '../../services/core/compose-parser';

describe('Compose Parser', () => {
  test('should parse compose.yaml and extract ports, volumes, and environment', async () => {
    // Create a temporary compose.yaml content for testing
    const composeContent = `
version: '3.8'
services:
  nginx:
    image: nginx:latest
    ports:
      - "8080:80"
      - "8443:443"
    volumes:
      - ./html:/usr/share/nginx/html:ro
      - ./conf:/etc/nginx/conf.d:ro
    environment:
      - NGINX_WORKER_PROCESSES=auto
      - NGINX_WORKER_CONNECTIONS=1024
`;

    // Mock the filesystem read for testing by creating a temporary file
    const fs = await import('fs');
    const path = await import('path');
    const os = await import('os');

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-test-'));
    const composePath = path.join(tempDir, 'compose.yaml');
    fs.writeFileSync(composePath, composeContent);

    try {
      const defaults = await parseComposeDefaults(tempDir);

      expect(defaults).toHaveProperty('ports');
      expect(defaults).toHaveProperty('volumes');
      expect(defaults).toHaveProperty('environment');

      // Check ports extraction
      expect(defaults.ports).toHaveLength(2);
      expect(defaults.ports.some(p => p.host === 8080 && p.container === 80)).toBe(true);
      expect(defaults.ports.some(p => p.host === 8443 && p.container === 443)).toBe(true);

      // Check volumes extraction  
      expect(defaults.volumes).toHaveLength(2);
      expect(defaults.volumes.some(v => v.hostPath === './html' && v.containerPath === '/usr/share/nginx/html')).toBe(true);
      expect(defaults.volumes.some(v => v.hostPath === './conf' && v.containerPath === '/etc/nginx/conf.d')).toBe(true);

      // Check environment extraction
      expect(defaults.environment).toHaveLength(2);
      expect(defaults.environment.some(e => e.key === 'NGINX_WORKER_PROCESSES' && e.value === 'auto')).toBe(true);
      expect(defaults.environment.some(e => e.key === 'NGINX_WORKER_CONNECTIONS' && e.value === '1024')).toBe(true);
      // Every compose-harvested row is flagged so the wizard/config UI can
      // collapse it behind Advanced (no packager-provided label exists for it).
      expect(defaults.environment.every(e => e.autoDetected === true)).toBe(true);
    } finally {
      // Clean up
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('should merge compose and manifest defaults with manifest precedence', () => {
    const composeDefaults = {
      ports: [{ host: 8080, container: 80, protocol: 'tcp' as const }],
      volumes: [{ hostPath: './data', containerPath: '/app/data', readOnly: false }],
      environment: [
        { key: 'NODE_ENV', value: 'production', isSecret: false, description: 'Environment' },
        { key: 'PORT', value: '3000', isSecret: false, description: 'Port number' },
      ],
    };

    const manifestDefaults = {
      ports: [{ host: 9090, container: 90, protocol: 'tcp' as const }],  // Different port
      volumes: [],  // No volume overrides
    };

    const manifestEnv = [
      { key: 'PORT', value: '4000', isSecret: false, description: 'Port override' },
      { key: 'DEBUG', value: 'true', isSecret: false, description: 'Debug flag' },
    ];

    const merged = mergeDefaults(composeDefaults, manifestDefaults, manifestEnv);

    // Ports should be combined
    expect(merged.defaults.ports).toHaveLength(2);
    expect(merged.defaults.ports.some(p => p.host === 8080 && p.container === 80)).toBe(true);
    expect(merged.defaults.ports.some(p => p.host === 9090 && p.container === 90)).toBe(true);

    // Volumes should be preserved
    expect(merged.defaults.volumes).toHaveLength(1);
    expect(merged.defaults.volumes.some(v => v.hostPath === './data' && v.containerPath === '/app/data')).toBe(true);

    // Environment should be combined
    expect(merged.defaultEnv.some(e => e.key === 'NODE_ENV' && e.value === 'production')).toBe(true); // From compose
    expect(merged.defaultEnv.some(e => e.key === 'PORT' && e.value === '4000')).toBe(true); // Manifest wins
    expect(merged.defaultEnv.some(e => e.key === 'DEBUG' && e.value === 'true')).toBe(true); // From manifest
  });

  test('manifest wins on key collision, dropping the compose row\'s autoDetected flag entirely', () => {
    const composeDefaults = {
      ports: [],
      volumes: [],
      environment: [
        { key: 'PORT', value: '3000', isSecret: false, description: 'Port number', autoDetected: true },
        { key: 'INTERNAL_DB_PASSWORD', value: 'baked-in', isSecret: true, description: 'DB password', autoDetected: true },
      ],
    };
    const manifestDefaults = { ports: [], volumes: [] };
    const manifestEnv = [{ key: 'PORT', value: '4000', isSecret: false, label: 'App Port' }];

    const merged = mergeDefaults(composeDefaults, manifestDefaults, manifestEnv);

    // The manifest-declared row fully replaces the compose one — no autoDetected leaks through.
    const port = merged.defaultEnv.find(e => e.key === 'PORT');
    expect(port).toMatchObject({ value: '4000', label: 'App Port' });
    expect(port?.autoDetected).toBeUndefined();

    // A key the manifest never mentions stays compose-derived and flagged.
    const dbPassword = merged.defaultEnv.find(e => e.key === 'INTERNAL_DB_PASSWORD');
    expect(dbPassword?.autoDetected).toBe(true);
  });

  test('should handle various compose environment formats', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const os = await import('os');

    const composeWithArrayEnv = `
version: '3.8'
services:
  app:
    environment:
      - NODE_ENV=production
      - DEBUG=false
`;

    const composeWithObjectEnv = `
version: '3.8'
services:
  app:
    environment:
      NODE_ENV: production
      DEBUG: false
`;

    const tempDir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-array-'));
    const tempDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-object-'));

    fs.writeFileSync(path.join(tempDir1, 'compose.yaml'), composeWithArrayEnv);
    const arrayDefaults = await parseComposeDefaults(tempDir1);

    fs.writeFileSync(path.join(tempDir2, 'compose.yaml'), composeWithObjectEnv);
    const objectDefaults = await parseComposeDefaults(tempDir2);

    try {
      // Both formats should produce the same result
      expect(arrayDefaults.environment.some(e => e.key === 'NODE_ENV' && e.value === 'production')).toBe(true);
      expect(arrayDefaults.environment.some(e => e.key === 'DEBUG' && e.value === 'false')).toBe(true);

      expect(objectDefaults.environment.some(e => e.key === 'NODE_ENV' && e.value === 'production')).toBe(true);
      expect(objectDefaults.environment.some(e => e.key === 'DEBUG' && e.value === 'false')).toBe(true);
    } finally {
      // Clean up
      fs.rmSync(tempDir1, { recursive: true, force: true });
      fs.rmSync(tempDir2, { recursive: true, force: true });
    }
  });
});