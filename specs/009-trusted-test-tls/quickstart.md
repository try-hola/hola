# Quickstart: Validate Trusted TLS on a Disposable VM (spec 009)

**Prerequisites:**
- The devcontainer has `.devcontainer/mcp.env` configured (Proxmox token and template).
- `bin/mcp-setup` passes.

The interfaces used below are defined in [contracts/harness-interface.md](contracts/harness-interface.md).

## 0. Offline selftests (no VM, seconds)

```bash
bash bin/lib/app-test.selftest.sh
bash bin/lib/trusted-tls.selftest.sh
bash bin/lib/test-ca-runtime.selftest.sh
bash bin/vm-test-ca.selftest.sh
```

Every test must exit 0.

## 1. Create the CA (once)

```bash
bin/vm-test-ca init          # → .devcontainer/.test-ca/{ca.pem,ca.key}
bin/vm-test-ca init          # exit 2, refuses to overwrite
bin/vm-test-ca status        # → trusted
git status --short           # nothing under .devcontainer/.test-ca appears
```

## 2. Spike the runtime shim and default cert (T001, before building on them)

Do this on a fresh VM (`bin/vm-create` + `bin/vm-wait-ssh`).

1. Run `tt_install_runtime`. Then check that `docker info --format '{{.DefaultRuntime}}'` returns `hola-test-ca`.
2. Run `docker run --rm alpine sh -c 'cat /proc/1/environ | tr "\0" "\n" | grep CA; ls -l /etc/hola-test-ca/bundle.pem'`. It should show all three variables and the read-only file.
3. Bootstrap. Then check that the server container's `/proc/1/environ` carries the variables too.
4. Run `tt_install_traefik_cert`. Then, for one host of each router kind, run `openssl s_client -connect <ip>:443 -servername <host> </dev/null | openssl x509 -noout -issuer`. Every one must show the test CA. The hosts to check:
   - `apps.<base>` (core)
   - `auth.<base>` (core, authentik)
   - an app host
   - an app's bypass path host
   - a forward-auth outpost path (`/outpost.goauthentik.io/`)

   Do this **without** restarting Traefik.

If any step fails, stop. Record the finding in research.md and do not substitute a server hook (spec FR-012).

## 3. Catalog run in trusted mode (SC-001, SC-004, SC-005)

```bash
bin/vm-catalog-test --apps gitea,immich,mealie,postiz,actual-budget --restart --keep
```

- **Expected:**
  - each app prints PASS, with no `sso-trust` FAIL;
  - `grep -rn -- ' -k \|NODE_TLS_REJECT_UNAUTHORIZED' logs/<run>/` finds nothing.
- **Redeploy survival (SC-005):** with `--restart`, the `sso-trust` probe re-runs after each app's server-driven restart, which re-materializes the compose. It must still pass. For an upgrade, use the rc-upgrade recipe on the kept VM, then run `bin/vm-sso-check --vmid <id> --app immich`.

## 4. Full SSO per runtime (SC-002)

```bash
bin/vm-sso-check --vmid <id> --app gitea --app immich --app mealie   # on the VM kept by step 3; installs any app that's absent
```

Expect `PASS sso gitea`, `PASS sso immich`, `PASS sso mealie`.

## 5. Service worker (SC-003)

```bash
bin/vm-sso-check --vmid <id> --app craft-apps --service-worker /effectcraft/   # installs craft-apps if absent
```

If the service worker does not register under the SPKI flag, switch to the NSS-DB fallback (research R6) and rerun.

## 6. Absent ⇒ unchanged (SC-004)

```bash
VM_TRUSTED_TLS=0 bin/vm-catalog-test --apps uptime-kuma
```

Expect today's output. None of the VM-side files in data-model.md exist on that VM. The golden-diff selftest covers this offline.

## 7. Cleanup

```bash
bin/vm-destroy --vmid <id> --yes
```
