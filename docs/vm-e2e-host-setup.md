# Preparing a Proxmox host for vm-e2e testing (agent runbook)

A paste-ready prompt/runbook for an **agent (or person) that has SSH access to
your Proxmox host and a checkout of this repo**. It (1) grants the API token the
privileges the `bin/vm-*` scripts need and (2) builds the cloud-init VM template
they clone. Afterward, the **devcontainer** side (a separate agent, using the API
token) clones and tests the template — see `docs/MCP_VM_TESTING.md` and the
`vm-e2e` skill.

Hand everything from the `--- TASK ---` line down to the agent, after filling in
the Environment block.

## Environment — fill these in

- `PVE_HOST`  = _Proxmox host or SSH alias you connect to, e.g. `pve1`_
- `SSH_USER`  = _a **sudo-capable** user on `PVE_HOST`, e.g. `root` or `admin`_
- `TOKEN_ID`  = _the API token id: `user@realm!tokenname`_
  - → `TOKEN_USER` = the `user@realm` part, `TOKEN_NAME` = the `tokenname` part
- `TEMPLATE_ID` = `9000` (headless) · `DESKTOP_TEMPLATE_ID` = `9001` (optional, browser stage)

The baked guest user is `hola` by default and **must match `VM_SSH_USER`** in
`.devcontainer/mcp.env`.

---

--- TASK ---

You are on a host with SSH access to `SSH_USER@PVE_HOST` (a Proxmox VE 8+ node)
and a checkout of the `hola` repo. Your job: grant the API token `TOKEN_ID` the
right Proxmox privileges and build a cloud-init VM template the repo's `bin/vm-*`
scripts can clone. A different agent (in a devcontainer, using the token) will
clone and test it afterward — **do not run `bin/vm-create` or anything in the
devcontainer**; your job ends at "template built + permissions granted + verified."

**Where things run:** `qm`/`pveum`/`virt-customize` exist only on `PVE_HOST`, so
run them there over SSH. Add `-t` to `ssh` if sudo prompts for a password. Don't
destroy anything you didn't create; never print the VNC password except in your
final report. `PVE_HOST` needs outbound internet (the build downloads the Ubuntu
cloud image + apt packages). `bin/proxmox-build-template` is one self-contained
file (sources nothing) meant to run as root on the PVE host.

### Step 0 — Recon (don't assume defaults). Run and record:
```
ssh SSH_USER@PVE_HOST 'pveversion'                              # confirm PVE 8+
ssh SSH_USER@PVE_HOST 'pvesm status; cat /etc/pve/storage.cfg'  # pick a storage whose content includes "images" -> STORAGE (e.g. local-lvm)
ssh SSH_USER@PVE_HOST 'ip -o link show type bridge'            # pick the LAN bridge -> BRIDGE (usually vmbr0)
ssh SSH_USER@PVE_HOST 'qm status 9000; qm status 9001'        # "does not exist" = free; else pick free IDs via: pvesh get /cluster/nextid
```

### Step 1 — Grant privileges to the token + verify:
```
ssh SSH_USER@PVE_HOST "sudo pveum acl modify / --roles PVEVMAdmin --users 'TOKEN_USER'"
ssh SSH_USER@PVE_HOST "sudo pveum user token modify TOKEN_USER TOKEN_NAME --privsep 0"
ssh SSH_USER@PVE_HOST 'sudo pveum acl list'                  # expect: path /, role PVEVMAdmin, user TOKEN_USER
ssh SSH_USER@PVE_HOST 'sudo pveum user token list TOKEN_USER' # expect: token TOKEN_NAME with privsep = 0
```
(`PVEVMAdmin` is a built-in role covering VM.Clone/Allocate/Config.Cloudinit/
PowerMgmt/Snapshot/Console/Monitor + Datastore.AllocateSpace. Disabling privsep
lets the token inherit the user's role; alternatively keep privsep and grant the
token directly with `--tokens 'TOKEN_ID'`.)

### Step 2 — Install the build dependency + verify:
```
ssh SSH_USER@PVE_HOST 'sudo apt-get update && sudo apt-get install -y libguestfs-tools'
ssh SSH_USER@PVE_HOST 'which virt-customize'   # must print a path
```

### Step 3 — Build the headless template (TEMPLATE_ID). From the repo root, pipe the script in (add `--storage <STORAGE> --bridge <BRIDGE>` if Step 0 found non-defaults; keep the default `--user hola`):
```
ssh SSH_USER@PVE_HOST 'sudo bash -s -- --id 9000 --dry-run' < bin/proxmox-build-template   # rehearse, changes nothing
ssh SSH_USER@PVE_HOST 'sudo bash -s -- --id 9000'           < bin/proxmox-build-template   # build for real
ssh SSH_USER@PVE_HOST 'qm config 9000'
```
The `qm config 9000` output **must** contain ALL of: `template: 1`,
`agent: enabled=1`, an `ide2: ...cloudinit` drive, a `scsi0:` disk, and
`ostype: l26`. If any are missing the template won't work with our scripts — stop
and report it.

### Step 4 — (Optional) Desktop template (DESKTOP_TEMPLATE_ID) for the browser stage.
Only if GUI/browser testing is wanted; this image is large and slow to build.
Generate a VNC password and report it back (the devcontainer side must set the
same value in `mcp.env`):
```
VNCPW=$(openssl rand -hex 12)
ssh SSH_USER@PVE_HOST "sudo VNC_PASSWORD='$VNCPW' bash -s -- --id 9001 --desktop" < bin/proxmox-build-template
ssh SSH_USER@PVE_HOST 'qm config 9001'     # same checks as Step 3
echo "VNC_PASSWORD=$VNCPW"                   # include this in your report
```

**If `virt-customize` errors** (appliance/permission issues), run
`ssh SSH_USER@PVE_HOST 'sudo libguestfs-test-tool 2>&1 | tail -20'` and include the
output in your report.

### Report back exactly:
1. PVE version; the STORAGE and BRIDGE you used.
2. Template VMID(s) built (headless, and desktop if done).
3. The `--user` baked in (should be `hola`).
4. Paste the two Step 1 verify outputs (ACL entry present + token `privsep=0`).
5. Paste the `qm config <id>` lines proving `template: 1`, `agent: enabled=1`, and
   the cloudinit drive.
6. If the desktop template was built: the `VNC_PASSWORD` value.
7. Anything changed from defaults, and any check that failed.
