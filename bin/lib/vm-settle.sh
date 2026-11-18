#!/usr/bin/env bash
# bin/lib/vm-settle.sh — wait for a fresh test VM's first boot to SETTLE (#574).
# TEST-HARNESS ONLY: nothing here touches the Hola product.
#
# A VM cloned from the test template runs cloud-init's package upgrade on first boot,
# which can install a kernel and REBOOT the VM a few minutes after SSH first answers
# (`package_reboot_if_required`). A reboot in the middle of `hola bootstrap` kills its
# install.sh, so every flow calls `vm_wait_settled <vmid>` right after bin/vm-wait-ssh
# and before bootstrap: wait until `cloud-init status --wait` returns, then require the
# VM to stay up (uptime keeps counting) for VM_SETTLE_SECS. SSH dropping at any point
# (the reboot itself) is retried until the VM is back, bounded by VM_SETTLE_TIMEOUT.
# No cloud-init on the guest -> nothing to wait for, returns 0 at once.
#
# SOURCE it (do not execute). Needs BIN_DIR (bin/vm-ssh lives there); log/warn/err from
# bin/_common.sh if present. Honours DRY_RUN=1 (logs, touches nothing).
# Tunables:
#   VM_SETTLE_TIMEOUT (900)  overall bound, seconds (falls back to TT_CLOUD_INIT_TIMEOUT)
#   VM_SETTLE_SECS    (20)   uptime-stability window after cloud-init is done (TT_SETTLE)
#   VM_SETTLE_RETRY   (5)    pause between attempts while SSH is down / VM not stable
[[ -n "${__VM_SETTLE_SH_LOADED:-}" ]] && return 0
__VM_SETTLE_SH_LOADED=1

: "${BIN_DIR:=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)}"

declare -F log  >/dev/null || log()  { echo "[vm] $*" >&2; }
declare -F warn >/dev/null || warn() { echo "[vm] warning: $*" >&2; }
declare -F err  >/dev/null || err()  { echo "[vm] error: $*" >&2; }

# _vs_ssh <vmid> <bound-seconds> <cmd>: one bounded vm-ssh call, stdin detached so it
# never eats a caller's input. The local `timeout` covers a session that hangs instead of
# dropping when the guest goes down mid-command.
_vs_ssh() {
  local vmid=$1 bound=$2; shift 2
  timeout "$bound" "$BIN_DIR/vm-ssh" --vmid "$vmid" -- "$@" </dev/null 2>/dev/null
}

# vm_wait_settled <vmid>  ->  0 settled (or no cloud-init), 1 timed out (message on stderr)
vm_wait_settled() {
  local vmid=${1:?vm_wait_settled: vmid required}
  local total=${VM_SETTLE_TIMEOUT:-${TT_CLOUD_INIT_TIMEOUT:-900}}
  local settle=${VM_SETTLE_SECS:-${TT_SETTLE:-20}} retry=${VM_SETTLE_RETRY:-5}
  if [[ "${DRY_RUN:-0}" == "1" ]]; then
    log "DRY_RUN: vm_wait_settled $vmid (cloud-init status --wait, then ${settle}s uptime stability; up to ${total}s)"
    return 0
  fi
  log "  waiting for VM $vmid's first-boot cloud-init to finish and the VM to stay up ${settle}s (up to ${total}s)"
  local deadline=$(( $(date +%s) + total )) rem out ci up1 up2 last="no SSH answer yet"
  while :; do
    rem=$(( deadline - $(date +%s) )); (( rem < 1 )) && rem=1
    # One round trip: is cloud-init installed, wait for it (bounded remotely too), report
    # its exit code and the uptime. "$?" is the REMOTE status, hence the single quotes.
    out=$(_vs_ssh "$vmid" $(( rem + 15 )) \
      'if command -v cloud-init >/dev/null 2>&1; then timeout '"$rem"' cloud-init status --wait >/dev/null 2>&1; echo "ci=$?"; else echo ci=absent; fi; echo "up=$(cut -d. -f1 /proc/uptime)"') || out=""
    ci=$(sed -n 's/^ci=\([0-9a-z]*\).*/\1/p' <<<"$out" | head -1)
    up1=$(sed -n 's/^up=\([0-9]*\).*/\1/p' <<<"$out" | head -1)
    case "$ci" in
      absent) log "  VM $vmid has no cloud-init; nothing to wait for"; return 0 ;;
      0|1|2)
        # 0 done, 2 done with recoverable errors, 1 done with errors: all finished.
        [[ "$ci" == 1 ]] && warn "  cloud-init on VM $vmid finished with errors (continuing)"
        if [[ -n "$up1" ]]; then
          sleep "$settle"
          up2=$(_vs_ssh "$vmid" 30 'cut -d. -f1 /proc/uptime' | tr -dc '0-9') || up2=""
          if [[ -n "$up2" ]] && (( up2 > up1 )); then
            log "  VM $vmid settled (cloud-init done, up ${up2}s)"; return 0
          fi
          last=$([[ -n "$up2" ]] && echo "VM rebooted after cloud-init finished (uptime ${up1}s -> ${up2}s)" \
                                  || echo "SSH dropped during the ${settle}s stability window (reboot?)")
        else
          last="cloud-init finished but uptime was unreadable"
        fi ;;
      "") last="SSH unavailable (VM rebooting?)" ;;
      *)  last="cloud-init still running (status --wait exit $ci)" ;;
    esac
    if (( $(date +%s) >= deadline )); then
      err "VM $vmid did not settle within ${total}s: $last. First-boot cloud-init (package upgrade + reboot) never finished with the VM staying up ${settle}s; raise VM_SETTLE_TIMEOUT or inspect the VM (bin/vm-ssh -- cloud-init status --long)"
      return 1
    fi
    log "  $last; retrying in ${retry}s"
    sleep "$retry"
  done
}
