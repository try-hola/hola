/**
 * Strict Compose validation tests (#13).
 *
 * Exercises the pure validator in @hola/shared across the acceptance-criteria
 * cases: malformed YAML, environment variants, undefined resources, unsupported
 * host-port exposure, and valid multi-service bundles.
 */

import { describe, test, expect } from 'bun:test';
import { validateComposeDocument } from '@hola/shared/compose-validate';
import type { ValidationIssue } from '@hola/shared';

const codes = (issues: ValidationIssue[]) => issues.map((i) => i.code);
const errors = (issues: ValidationIssue[]) => issues.filter((i) => i.severity === 'error');

describe('validateComposeDocument', () => {
  test('malformed YAML yields a single INVALID_YAML error', () => {
    const issues = validateComposeDocument('services: [unclosed');
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('INVALID_YAML');
    expect(issues[0].severity).toBe('error');
    expect(issues[0].message).toMatch(/Invalid Compose YAML/);
  });

  test('empty document reports NO_SERVICES', () => {
    expect(codes(validateComposeDocument(''))).toContain('NO_SERVICES');
  });

  test('document without services reports NO_SERVICES', () => {
    expect(codes(validateComposeDocument('version: "3"\n'))).toContain('NO_SERVICES');
  });

  test('a valid single-service bundle passes clean', () => {
    const yaml = `
services:
  web:
    image: nginx:1.27
    expose:
      - "80"
    environment:
      - LOG_LEVEL=info
`;
    expect(validateComposeDocument(yaml)).toEqual([]);
  });

  test('a service gated behind a Compose profile passes clean (#162)', () => {
    // An optional heavy dependency (e.g. Postiz's Elasticsearch) is gated behind a
    // `profiles:` key. The validator must not choke on it — it is how the platform
    // makes a service opt-in. `profiles:` publishes no host port, so it is allowed.
    const yaml = `
services:
  app:
    image: ghcr.io/acme/app:1.2.3
    expose:
      - "3000"
  elasticsearch:
    image: elasticsearch:8.15.0
    profiles:
      - elasticsearch
    expose:
      - "9200"
`;
    expect(validateComposeDocument(yaml)).toEqual([]);
  });

  test('a valid multi-service bundle with defined resources passes clean', () => {
    const yaml = `
services:
  app:
    image: ghcr.io/acme/app:1.2.3
    environment:
      APP_ENV: production
    volumes:
      - \${HOLA_APP_DATA}/app:/var/lib/app
      - \${HOLA_APP_DATA}/config:/etc/app:ro
    networks:
      - backend
    secrets:
      - api_key
  db:
    image: postgres:16
    volumes:
      - \${HOLA_APP_DATA}/db:/var/lib/postgresql/data
    networks:
      - backend
networks:
  backend:
secrets:
  api_key:
    external: true
`;
    expect(validateComposeDocument(yaml)).toEqual([]);
  });

  describe('host-port rejection', () => {
    test('short string form is rejected', () => {
      const yaml = `
services:
  web:
    image: nginx:1.27
    ports:
      - "8080:80"
`;
      const errs = errors(validateComposeDocument(yaml));
      expect(errs).toHaveLength(1);
      expect(errs[0].code).toBe('HOST_PORT_NOT_ALLOWED');
      expect(errs[0].path).toBe('services.web.ports[0]');
    });

    test('host_ip form is rejected', () => {
      const yaml = `
services:
  web:
    image: nginx:1.27
    ports:
      - "127.0.0.1:8080:80"
`;
      expect(codes(validateComposeDocument(yaml))).toContain('HOST_PORT_NOT_ALLOWED');
    });

    test('long published form is rejected', () => {
      const yaml = `
services:
  web:
    image: nginx:1.27
    ports:
      - target: 80
        published: 8080
`;
      expect(codes(validateComposeDocument(yaml))).toContain('HOST_PORT_NOT_ALLOWED');
    });

    test('expose (container-internal) is allowed', () => {
      const yaml = `
services:
  web:
    image: nginx:1.27
    expose:
      - "80"
`;
      expect(validateComposeDocument(yaml)).toEqual([]);
    });

    test('network_mode: host is rejected (publishes all ports on the host)', () => {
      const yaml = `
services:
  web:
    image: nginx:1.27
    network_mode: host
`;
      const errs = errors(validateComposeDocument(yaml));
      expect(errs).toHaveLength(1);
      expect(errs[0].code).toBe('HOST_NETWORK_MODE_NOT_ALLOWED');
      expect(errs[0].path).toBe('services.web.network_mode');
    });

    test('non-host network_mode (e.g. service:) is allowed', () => {
      const yaml = `
services:
  app:
    image: nginx:1.27
  sidecar:
    image: curlimages/curl:8.7.1
    network_mode: "service:app"
`;
      expect(validateComposeDocument(yaml)).toEqual([]);
    });

    test('a host port hidden behind a YAML merge key is still rejected', () => {
      // Without merge-key resolution, `<<: *ports` would leave `ports` invisible
      // to the validator while Docker Compose still publishes it.
      const yaml = `
x-ports: &ports
  ports:
    - "9090:90"
services:
  web:
    image: nginx:1.27
    <<: *ports
`;
      const errs = errors(validateComposeDocument(yaml));
      expect(errs).toHaveLength(1);
      expect(errs[0].code).toBe('HOST_PORT_NOT_ALLOWED');
    });
  });

  describe('image tag pinning', () => {
    test('explicit mutable tag (latest) is rejected', () => {
      const yaml = `
services:
  web:
    image: nginx:latest
`;
      const errs = errors(validateComposeDocument(yaml));
      expect(errs).toHaveLength(1);
      expect(errs[0].code).toBe('IMAGE_MUTABLE_TAG');
      expect(errs[0].path).toBe('services.web.image');
    });

    test('other mutable tags (stable) are rejected', () => {
      const yaml = `
services:
  web:
    image: traefik:stable
`;
      expect(codes(validateComposeDocument(yaml))).toContain('IMAGE_MUTABLE_TAG');
    });

    test('a specific version tag passes clean', () => {
      const yaml = `
services:
  web:
    image: nginx:1.27.0
`;
      expect(validateComposeDocument(yaml)).toEqual([]);
    });

    test('a digest-pinned image passes clean even with a mutable-looking tag', () => {
      const yaml = `
services:
  web:
    image: nginx:latest@sha256:0000000000000000000000000000000000000000000000000000000000000000
`;
      expect(validateComposeDocument(yaml)).toEqual([]);
    });

    test('a registry-port reference is tagged correctly (not confused with the tag colon)', () => {
      const yaml = `
services:
  web:
    image: registry.example.com:5000/team/app:2.1.0
`;
      expect(validateComposeDocument(yaml)).toEqual([]);
    });

    test('a registry-port reference with no tag is still rejected', () => {
      const yaml = `
services:
  web:
    image: registry.example.com:5000/team/app
`;
      expect(codes(validateComposeDocument(yaml))).toContain('IMAGE_MISSING_TAG');
    });
  });

  describe('service shape', () => {
    test('image and build together conflict', () => {
      const yaml = `
services:
  web:
    image: nginx:1.27
    build: ./web
`;
      expect(codes(validateComposeDocument(yaml))).toContain('IMAGE_AND_BUILD_CONFLICT');
    });

    test('neither image nor build is rejected', () => {
      const yaml = `
services:
  web:
    environment:
      - A=b
`;
      expect(codes(validateComposeDocument(yaml))).toContain('MISSING_IMAGE_OR_BUILD');
    });

    test('build-only service is valid', () => {
      const yaml = `
services:
  web:
    build: ./web
`;
      expect(validateComposeDocument(yaml)).toEqual([]);
    });

    test('image without tag is rejected (implicit :latest is mutable)', () => {
      const yaml = `
services:
  web:
    image: nginx
`;
      const errs = errors(validateComposeDocument(yaml));
      expect(errs).toHaveLength(1);
      expect(errs[0].code).toBe('IMAGE_MISSING_TAG');
      expect(errs[0].path).toBe('services.web.image');
    });

    test('invalid service name is rejected', () => {
      const yaml = `
services:
  "bad name!":
    image: nginx:1.27
`;
      expect(codes(validateComposeDocument(yaml))).toContain('INVALID_SERVICE_NAME');
    });

    test('a user-authored service named hola-docker-proxy is rejected (spec 004: reserved for the platform)', () => {
      const yaml = `
services:
  hola-docker-proxy:
    image: nginx:1.27
`;
      const errs = errors(validateComposeDocument(yaml));
      expect(errs.map((e) => e.code)).toContain('RESERVED_SERVICE_NAME');
    });
  });

  describe('environment forms', () => {
    test('object form is accepted', () => {
      const yaml = `
services:
  web:
    image: nginx:1.27
    environment:
      KEY: value
`;
      expect(validateComposeDocument(yaml)).toEqual([]);
    });

    test('duplicate keys in list form warn', () => {
      const yaml = `
services:
  web:
    image: nginx:1.27
    environment:
      - KEY=a
      - KEY=b
`;
      expect(codes(validateComposeDocument(yaml))).toContain('DUPLICATE_ENV_KEY');
    });

    test('scalar environment is an invalid form', () => {
      const yaml = `
services:
  web:
    image: nginx:1.27
    environment: "not-a-map"
`;
      expect(codes(validateComposeDocument(yaml))).toContain('INVALID_ENV_FORM');
    });
  });

  describe('undefined resource references', () => {
    test('named volumes are not allowed (must use the app-data root)', () => {
      const yaml = `
services:
  web:
    image: nginx:1.27
    volumes:
      - data:/var/lib/app
`;
      const errs = errors(validateComposeDocument(yaml));
      expect(errs.map((e) => e.code)).toContain('NAMED_VOLUME_NOT_ALLOWED');
    });

    test('bind mounts must be rooted at the app-data token', () => {
      const yaml = `
services:
  web:
    image: nginx:1.27
    volumes:
      - ./config:/etc/app:ro
      - /var/run/docker.sock:/var/run/docker.sock
`;
      expect(codes(validateComposeDocument(yaml))).toContain('VOLUME_NOT_UNDER_APP_DATA');
    });

    test('pinned: the docker socket, docker log dir, and their parents are rejected (spec 004 FR-025)', () => {
      const paths = [
        '/var/run/docker.sock',
        '/var/lib/docker/containers',
        '/var/lib/docker',
        '/var/run',
      ];
      for (const p of paths) {
        const yaml = `services:\n  web:\n    image: nginx:1.27\n    volumes:\n      - ${p}:${p}\n`;
        expect(codes(validateComposeDocument(yaml))).toContain('VOLUME_NOT_UNDER_APP_DATA');
      }
    });

    test('pinned: the docker socket is rejected in long syntax too', () => {
      const yaml = `
services:
  web:
    image: nginx:1.27
    volumes:
      - type: bind
        source: /var/run/docker.sock
        target: /var/run/docker.sock
`;
      expect(codes(validateComposeDocument(yaml))).toContain('VOLUME_NOT_UNDER_APP_DATA');
    });

    test('bind mounts under the app-data root are accepted', () => {
      const yaml = `
services:
  web:
    image: nginx:1.27
    volumes:
      - \${HOLA_APP_DATA}/config:/etc/app:ro
      - \${HOLA_APP_DATA}/data:/data
`;
      expect(validateComposeDocument(yaml)).toEqual([]);
    });

    test('known platform tokens in env are accepted', () => {
      const yaml = `
services:
  web:
    image: nginx:1.27
    environment:
      DOMAIN: https://\${HOLA_APP_HOST}/
      BASE: \${HOLA_BASE_DOMAIN}
      ADMIN_EMAIL: \${HOLA_USER_EMAIL}
`;
      expect(validateComposeDocument(yaml)).toEqual([]);
    });

    test('unknown HOLA_* token is warned (likely a typo)', () => {
      const yaml = `
services:
  web:
    image: nginx:1.27
    environment:
      DOMAIN: \${HOLA_APP_HSOT}
`;
      const issues = validateComposeDocument(yaml);
      expect(codes(issues)).toContain('UNKNOWN_PLATFORM_TOKEN');
      // Advisory only — does not block.
      expect(issues.every((i) => i.severity !== 'error')).toBe(true);
    });

    test('undefined network is rejected', () => {
      const yaml = `
services:
  web:
    image: nginx:1.27
    networks:
      - missing
`;
      expect(codes(validateComposeDocument(yaml))).toContain('UNDEFINED_NETWORK');
    });

    test('undefined secret is rejected', () => {
      const yaml = `
services:
  web:
    image: nginx:1.27
    secrets:
      - missing
`;
      expect(codes(validateComposeDocument(yaml))).toContain('UNDEFINED_SECRET');
    });
  });

  test('unsupported top-level key warns', () => {
    const yaml = `
bogus: true
services:
  web:
    image: nginx:1.27
`;
    const issues = validateComposeDocument(yaml);
    expect(errors(issues)).toEqual([]);
    expect(codes(issues)).toContain('UNSUPPORTED_KEY');
  });
});
