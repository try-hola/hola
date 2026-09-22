/**
 * Compose policy constrains the configuration Docker executes (F02).
 *
 * An external security review found the validator constrained an app's compose
 * only where the document was literal and only for the keys it happened to
 * know:
 *
 *  (a) path containment was proved PRE-interpolation, so
 *      `${HOLA_APP_DATA}/${ESCAPE}:/data` validated clean and then resolved,
 *      through the app's own `runtime/.env`, to a bind source anywhere on the
 *      host; and
 *  (b) nothing looked at the privilege-bearing keys at all — `privileged` with
 *      `pid: host`, a file-backed secret reading another app's data, and an
 *      `extends` pulling an unvalidated service body all passed.
 *
 * Each `test` below that names a reviewer case fails on the pre-fix validator.
 * The positive cases pin the real catalog shapes the rules must not reject, and
 * the last describe block pins the ordering that keeps the platform's own
 * post-validation injections out of scope.
 */

import { describe, test, expect } from 'bun:test';
import { validateComposeDocument } from '@hola/shared/compose-validate';
import { injectContainerLogsSource } from '../../services/core/compose-mounts';
import type { ValidationIssue } from '@hola/shared';

const codes = (issues: ValidationIssue[]) => issues.map((i) => i.code);
const errors = (issues: ValidationIssue[]) => issues.filter((i) => i.severity === 'error');
const errorCodes = (issues: ValidationIssue[]) => errors(issues).map((i) => i.code);

describe('F02a — bind-source containment survives interpolation', () => {
  test("reviewer case: `${HOLA_APP_DATA}/${ESCAPE}:/data` is refused", () => {
    // The exact document the reviewer reported as validating clean. `ESCAPE`
    // is the app's OWN env var, so it reaches Compose through
    // `deployments/<id>/runtime/.env` no matter how tightly the server's own
    // environment is scrubbed (F01) — `ESCAPE=../../../../var/run` relocates
    // the mount onto the directory holding the Docker socket.
    const yaml = `
services:
  app:
    image: ghcr.io/acme/app:1.2.3
    environment:
      ESCAPE: "../../../../var/run"
    volumes:
      - \${HOLA_APP_DATA}/\${ESCAPE}:/data
`;
    const issues = validateComposeDocument(yaml);
    expect(errorCodes(issues)).toContain('VOLUME_SOURCE_INTERPOLATED');
    expect(errors(issues)[0].path).toBe('services.app.volumes[0]');
    expect(errors(issues)[0].message).toContain('${ESCAPE}');
  });

  test('a variable anywhere in the source suffix is refused, braced or not', () => {
    for (const source of [
      '${HOLA_APP_DATA}/${SUB}/data',
      '${HOLA_APP_DATA}/data-${SUFFIX}',
      '${HOLA_APP_DATA}/$SUB',
      '${HOLA_APP_DATA}/${SUB:-../..}',
    ]) {
      const yaml = `services:\n  app:\n    image: nginx:1.27\n    volumes:\n      - "${source}:/data"\n`;
      expect(errorCodes(validateComposeDocument(yaml))).toContain('VOLUME_SOURCE_INTERPOLATED');
    }
  });

  test('`$$` in a source is refused too rather than reasoned about', () => {
    // `$$` is Compose's escape for a literal `$`. Accepting it would mean
    // re-implementing Compose's escaping rules correctly to stay safe, for a
    // directory name no app needs.
    const yaml = 'services:\n  app:\n    image: nginx:1.27\n    volumes:\n      - "${HOLA_APP_DATA}/a$$b:/data"\n';
    expect(errorCodes(validateComposeDocument(yaml))).toContain('VOLUME_SOURCE_INTERPOLATED');
  });

  test('the long-syntax `source` is checked the same way', () => {
    const yaml = `
services:
  app:
    image: nginx:1.27
    volumes:
      - type: bind
        source: \${HOLA_APP_DATA}/\${ESCAPE}
        target: /data
`;
    expect(errorCodes(validateComposeDocument(yaml))).toContain('VOLUME_SOURCE_INTERPOLATED');
  });

  test('interpolation in the CONTAINER path is still allowed', () => {
    // The target is a path inside the container; there is no host reach to
    // contain, and apps legitimately parameterise it.
    const yaml = 'services:\n  app:\n    image: nginx:1.27\n    volumes:\n      - "${HOLA_APP_DATA}/data:/srv/${SUBDIR}"\n';
    expect(errors(validateComposeDocument(yaml))).toEqual([]);
  });

  test('the platform token itself is still accepted, alone and with a literal suffix', () => {
    for (const source of ['${HOLA_APP_DATA}', '${HOLA_APP_DATA}/data', '${HOLA_APP_DATA}/a/b/c']) {
      const yaml = `services:\n  app:\n    image: nginx:1.27\n    volumes:\n      - "${source}:/data"\n`;
      expect(errors(validateComposeDocument(yaml))).toEqual([]);
    }
  });
});

describe('F02b — privilege-bearing keys are refused', () => {
  test('reviewer case: `privileged: true` with `pid: host`', () => {
    const yaml = `
services:
  app:
    image: ghcr.io/acme/app:1.2.3
    privileged: true
    pid: host
`;
    const issues = validateComposeDocument(yaml);
    // `pid: host` is refused outright; `privileged` is surfaced as a warning
    // (two shipped catalog apps depend on it — see the validator's comment).
    expect(errorCodes(issues)).toEqual(['PRIVILEGED_KEY_NOT_ALLOWED']);
    expect(errors(issues)[0].path).toBe('services.app.pid');
    expect(codes(issues)).toContain('PRIVILEGED_SERVICE');
  });

  test('reviewer case: a file-backed secret naming another app\'s data', () => {
    const yaml = `
services:
  app:
    image: ghcr.io/acme/app:1.2.3
    secrets:
      - victim_key
secrets:
  victim_key:
    file: /data/apps/dep_other/config/admin-api-key
`;
    const issues = validateComposeDocument(yaml);
    expect(errorCodes(issues)).toContain('FILE_SOURCE_NOT_ALLOWED');
    expect(errors(issues)[0].path).toBe('secrets.victim_key.file');
  });

  test('reviewer case: an external `extends`', () => {
    const yaml = `
services:
  app:
    image: ghcr.io/acme/app:1.2.3
    extends:
      file: /srv/elsewhere/compose.yml
      service: anything
`;
    expect(errorCodes(validateComposeDocument(yaml))).toContain('PRIVILEGED_KEY_NOT_ALLOWED');
  });

  test('a file-backed top-level config is refused the same way', () => {
    const yaml = `
services:
  app:
    image: nginx:1.27
configs:
  hijack:
    file: /etc/shadow
`;
    expect(errorCodes(validateComposeDocument(yaml))).toContain('FILE_SOURCE_NOT_ALLOWED');
  });

  const refused: Array<[string, string]> = [
    ['pid', 'pid: host'],
    ['ipc', 'ipc: host'],
    ['uts', 'uts: host'],
    ['cgroup', 'cgroup: host'],
    ['devices', 'devices:\n      - /dev/sda:/dev/sda'],
    ['device_cgroup_rules', 'device_cgroup_rules:\n      - "c 10:200 rwm"'],
    ['cap_add', 'cap_add:\n      - SYS_ADMIN'],
    ['group_add', 'group_add:\n      - "999"'],
    ['env_file', 'env_file:\n      - ../../other/runtime/.env'],
    ['extends', 'extends:\n      file: /elsewhere/compose.yml\n      service: x'],
    ['userns_mode', 'userns_mode: host'],
    ['sysctls', 'sysctls:\n      net.ipv4.ip_forward: "1"'],
    ['cgroup_parent', 'cgroup_parent: /elsewhere'],
    ['runtime', 'runtime: sysbox-runc'],
    ['volumes_from', 'volumes_from:\n      - container:hola-server'],
  ];

  test.each(refused)('`%s` is refused, naming the key and the service', (key, snippet) => {
    const yaml = `services:\n  app:\n    image: nginx:1.27\n    ${snippet}\n`;
    const issues = validateComposeDocument(yaml);
    const refusal = errors(issues).find((i) => i.code === 'PRIVILEGED_KEY_NOT_ALLOWED');
    expect(refusal).toBeDefined();
    expect(refusal!.path).toBe(`services.app.${key}`);
    expect(refusal!.message).toContain(`Service 'app'`);
    expect(refusal!.message).toContain(`'${key}'`);
  });

  test('a guarded key present but empty grants nothing and is not refused', () => {
    // `cap_add:` with nothing after it parses to null; refusing it would reject
    // a comment-shaped no-op rather than a privilege.
    const yaml = 'services:\n  app:\n    image: nginx:1.27\n    cap_add:\n    devices: []\n';
    expect(errors(validateComposeDocument(yaml))).toEqual([]);
  });

  test('`cap_drop` is a narrowing and stays allowed', () => {
    const yaml = 'services:\n  app:\n    image: nginx:1.27\n    cap_drop:\n      - ALL\n';
    expect(errors(validateComposeDocument(yaml))).toEqual([]);
  });

  test('a widening `security_opt` entry is refused; the platform hardening is not', () => {
    for (const entry of ['seccomp:unconfined', 'apparmor:unconfined', 'systempaths=unconfined', 'label:disable', 'no-new-privileges:false']) {
      const yaml = `services:\n  app:\n    image: nginx:1.27\n    security_opt:\n      - ${entry}\n`;
      const issues = validateComposeDocument(yaml);
      expect(errorCodes(issues)).toContain('SECURITY_OPT_NOT_ALLOWED');
      expect(errors(issues)[0].path).toBe('services.app.security_opt[0]');
    }
    const ok = 'services:\n  app:\n    image: nginx:1.27\n    security_opt:\n      - no-new-privileges:true\n';
    expect(errors(validateComposeDocument(ok))).toEqual([]);
  });

  test('a bare-string `security_opt` is checked too, not only the list form', () => {
    // Compose's schema wants a list and would reject a string, but a rule that
    // only looks at the shape it expects is not a rule.
    const yaml = 'services:\n  app:\n    image: nginx:1.27\n    security_opt: seccomp:unconfined\n';
    const issues = validateComposeDocument(yaml);
    expect(errorCodes(issues)).toContain('SECURITY_OPT_NOT_ALLOWED');
    expect(errors(issues)[0].path).toBe('services.app.security_opt');
  });

  test('`network_mode: container:<id>` is refused; `service:<name>` is not', () => {
    const foreign = 'services:\n  app:\n    image: nginx:1.27\n    network_mode: "container:hola-server"\n';
    expect(errorCodes(validateComposeDocument(foreign))).toContain('FOREIGN_NETWORK_MODE_NOT_ALLOWED');

    const sibling = 'services:\n  app:\n    image: nginx:1.27\n  side:\n    image: busybox:1.36\n    network_mode: "service:app"\n';
    expect(errors(validateComposeDocument(sibling))).toEqual([]);
  });

  test('a privilege key hidden behind a YAML merge key is still refused', () => {
    // The document is parsed with `merge: true`, so an anchor cannot smuggle a
    // guarded field past the per-service walk.
    const yaml = `
x-base: &base
  pid: host
services:
  app:
    <<: *base
    image: nginx:1.27
`;
    expect(errorCodes(validateComposeDocument(yaml))).toContain('PRIVILEGED_KEY_NOT_ALLOWED');
  });
});

describe('F02 — the real catalog shapes still validate', () => {
  // One fixture per shape the new rules had to be narrowed around, reduced from
  // the actual try-hola/apps bundles. `bin/validate-manifest.mjs` plus a sweep
  // of every `src/*/src/compose.yaml` through this validator is the full check;
  // these pin the specific shapes in this repo's own suite.
  const shapes: Array<[string, string]> = [
    // gitea: a Docker-in-Docker Actions runner sidecar. `privileged` warns, but
    // must not error — this app has no other way to run jobs, precisely because
    // the host socket is forbidden.
    ['gitea (dind runner sidecar)', `
services:
  gitea:
    image: gitea/gitea:1.27.0
    expose:
      - "3000"
    volumes:
      - \${HOLA_APP_DATA}/data:/data
  gitea-runner:
    image: gitea/act_runner:0.6.1-dind
    privileged: true
    volumes:
      - \${HOLA_APP_DATA}/runner:/data
      - \${HOLA_APP_DATA}/runner-docker:/var/lib/docker
`],
    // running-man: the same shape, with the dind socket shared through the
    // app's own data root rather than the host's.
    ['running-man (dind socket via app data)', `
services:
  running-man:
    image: ghcr.io/acme/running-man:1.4.0
    expose:
      - "8080"
    volumes:
      - \${HOLA_APP_DATA}/data:/app/data
      - \${HOLA_APP_DATA}/dind-sock:/var/run/dind
  running-man-dind:
    image: docker:29.7.1-dind
    privileged: true
    volumes:
      - \${HOLA_APP_DATA}/dind-sock:/var/run
      - \${HOLA_APP_DATA}/dind-docker:/var/lib/docker
`],
    // webtop: `shm_size` (not a guarded key) and no security_opt of its own.
    ['webtop (shm_size, expose)', `
services:
  webtop:
    image: lscr.io/linuxserver/webtop:ubuntu-kde-ls167
    volumes:
      - \${HOLA_APP_DATA}/config:/config
    expose:
      - "3000"
    shm_size: "1gb"
`],
    // remo: a `tmpfs` list, whose entries are container paths and must not be
    // read as bind sources.
    ['remo (tmpfs)', `
services:
  remo:
    image: ghcr.io/acme/remo-web:2.2.0
    volumes:
      - \${HOLA_APP_DATA}/config:/home/remo/.config/remo
    tmpfs:
      - /run/remo-ssh
`],
    // guacamole: a read-only bind and a `user:` override.
    ['guacamole (ro bind, user override)', `
services:
  guacamole-postgres:
    image: postgres:16.4
    user: "0:0"
    volumes:
      - \${HOLA_APP_DATA}/postgres:/var/lib/postgresql/data
      - \${HOLA_APP_DATA}/initdb:/docker-entrypoint-initdb.d:ro
      - \${HOLA_APP_DATA}/backups:/backups
`],
    // immich: an app-data root mounted whole plus a profiled service.
    ['immich (root mount, profiles)', `
services:
  immich:
    image: ghcr.io/immich-app/immich-server:v1.119.0
    expose:
      - "2283"
    volumes:
      - \${HOLA_APP_DATA}/library:/data
      - \${HOLA_APP_DATA}/config:/config
  immich-postgres:
    image: docker.io/tensorchord/pgvecto-rs:pg16-v0.3.0
    shm_size: 128mb
    volumes:
      - \${HOLA_APP_DATA}/postgres:/var/lib/postgresql/data
  immich-ml:
    image: ghcr.io/immich-app/immich-machine-learning:v1.119.0
    profiles:
      - machine-learning
    volumes:
      - \${HOLA_APP_DATA}/model-cache:/cache
`],
  ];

  test.each(shapes)('%s validates with no errors', (_name, yaml) => {
    expect(errors(validateComposeDocument(yaml))).toEqual([]);
  });

  test('the two dind shapes warn about privileged rather than failing', () => {
    const [, gitea] = shapes[0];
    const issues = validateComposeDocument(gitea);
    expect(errors(issues)).toEqual([]);
    const warning = issues.find((i) => i.code === 'PRIVILEGED_SERVICE');
    expect(warning?.severity).toBe('warning');
    expect(warning?.path).toBe('services.gitea-runner.privileged');
  });
});

describe('F02 — the platform sidecar is injected after validation', () => {
  // The rules above would refuse the container-logs proxy sidecar outright: it
  // binds the host Docker socket (outside any app data root) under a reserved
  // service name. That is fine, and this pins WHY rather than assuming it —
  // `injectContainerLogsSource` runs inside `materializeCompose`, on the
  // already-validated document, and its output is never fed back through the
  // validator.
  const appYaml = `
services:
  logger:
    image: ghcr.io/acme/logger:1.0.0
    expose:
      - "8080"
    volumes:
      - \${HOLA_APP_DATA}/data:/data
`;

  test("the provider's own compose — the document that IS validated — passes clean", () => {
    expect(validateComposeDocument(appYaml)).toEqual([]);
  });

  test('the injected sidecar is what the validator would refuse, and is never shown to it', () => {
    const injected = injectContainerLogsSource(appYaml, {
      image: 'ghcr.io/try-hola/server:0.11.0',
      socketPath: '/var/run/docker.sock',
      labels: { 'sh.hola.app': 'logger' },
    });
    expect(injected).toContain('hola-docker-proxy');
    expect(injected).toContain('/var/run/docker.sock:/var/run/docker.sock:ro');

    // Re-validating the materialised document would reject the platform's own
    // grant — which is exactly why materialisation is downstream of validation.
    const wouldRefuse = errorCodes(validateComposeDocument(injected));
    expect(wouldRefuse).toContain('RESERVED_SERVICE_NAME');
    expect(wouldRefuse).toContain('VOLUME_NOT_UNDER_APP_DATA');
  });

  test("the sidecar's own security_opt is the one form an app may also state", () => {
    // So the allowlist-of-one is not accidentally narrower than the platform's
    // own hardening.
    const injected = injectContainerLogsSource(appYaml, {
      image: 'ghcr.io/try-hola/server:0.11.0',
      socketPath: '/var/run/docker.sock',
      labels: {},
    });
    expect(injected).toContain('no-new-privileges:true');
    const appStated = 'services:\n  app:\n    image: nginx:1.27\n    security_opt:\n      - no-new-privileges:true\n';
    expect(errors(validateComposeDocument(appStated))).toEqual([]);
  });
});
