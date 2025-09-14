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
      expect(defaults.ports).toContain('8080:80');
      expect(defaults.ports).toContain('8443:443');

      // Check volumes extraction
      expect(defaults.volumes).toContain('./html:/usr/share/nginx/html:ro');
      expect(defaults.volumes).toContain('./conf:/etc/nginx/conf.d:ro');

      // Check environment extraction
      expect(defaults.environment).toHaveProperty('NGINX_WORKER_PROCESSES', 'auto');
      expect(defaults.environment).toHaveProperty('NGINX_WORKER_CONNECTIONS', '1024');
    } finally {
      // Clean up
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('should merge compose and manifest defaults with manifest precedence', () => {
    const composeDefaults = {
      ports: ['8080:80'],
      volumes: ['./data:/app/data'],
      environment: {
        'NODE_ENV': 'production',
        'PORT': '3000',
      },
    };

    const manifestDefaults = {
      ports: ['9090:90'],  // Different port
      environment: {
        'PORT': '4000',    // Override
        'DEBUG': 'true',   // Additional
      },
    };

    const merged = mergeDefaults(composeDefaults, manifestDefaults);

    // Ports should be combined
    expect(merged.ports).toContain('8080:80');
    expect(merged.ports).toContain('9090:90');

    // Volumes should be preserved
    expect(merged.volumes).toContain('./data:/app/data');

    // Environment should be combined with compose first, then manifest
    expect(merged.environment['NODE_ENV']).toBe('production'); // From compose
    expect(merged.environment['PORT']).toBe('4000'); // Manifest wins
    expect(merged.environment['DEBUG']).toBe('true'); // From manifest
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
      expect(arrayDefaults.environment['NODE_ENV']).toBe('production');
      expect(arrayDefaults.environment['DEBUG']).toBe('false');

      expect(objectDefaults.environment['NODE_ENV']).toBe('production');
      expect(objectDefaults.environment['DEBUG']).toBe('false');
    } finally {
      // Clean up
      fs.rmSync(tempDir1, { recursive: true, force: true });
      fs.rmSync(tempDir2, { recursive: true, force: true });
    }
  });
});