#!/usr/bin/env bash
# Self-test for bin/lib/vm-settle.sh (#574): vm_wait_settled against a scripted vm-ssh
# stub — cloud-init done; running then done; SSH dropping (reboot) then returning; a
# reboot inside the stability window; cloud-init absent; timeout; dry run.
# No VM, no network, seconds.
# Run: bash bin/lib/vm-settle.selftest.sh   (exit 0 = pass)
set -euo pipefail
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin"

# Scripted stub: each call consumes the next line of $STUB_SCRIPT, "<rc> <output>"
# (output may use \n). Past the end, the last line repeats. Every call is logged.
cat > "$T/bin/vm-ssh" <<'S'
#!/usr/bin/env bash
shift 2; [[ "$1" == "--" ]] && shift          # --vmid N --
echo "$*" >> "$STUB_CALLS"
n=$(wc -l < "$STUB_CALLS")
line=$(sed -n "${n}p" "$STUB_SCRIPT"); [[ -n "$line" ]] || line=$(tail -1 "$STUB_SCRIPT")
rc=${line%% *}; out=${line#* }; [[ "$out" == "$line" ]] && out=""
[[ -n "$out" ]] && printf '%b\n' "$out"
exit "$rc"
S
chmod +x "$T/bin/vm-ssh"
exec < /dev/null

BIN_DIR="$T/bin"
export STUB_CALLS="$T/calls" STUB_SCRIPT="$T/script" VM_SETTLE_SECS=0 VM_SETTLE_RETRY=0 VM_SETTLE_TIMEOUT=30
# shellcheck source=/dev/null
source "$HERE/vm-settle.sh"

fails=0
ok()  { echo "  ok   $1"; }
bad() { echo "  FAIL $1"; fails=$((fails+1)); }
# scenario <script-lines...>: reset the stub, run vm_wait_settled 101, set RC/CALLS/ERR.
scenario() {
  printf '%s\n' "$@" > "$STUB_SCRIPT"; : > "$STUB_CALLS"
  RC=0; vm_wait_settled 101 2>"$T/err" || RC=$?
  CALLS=$(wc -l < "$STUB_CALLS"); ERR=$(cat "$T/err")
}

scenario '0 ci=0\nup=100' '0 200'
[[ "$RC" == 0 && "$CALLS" == 2 ]] && ok "cloud-init done + uptime keeps counting -> 0 (2 calls)" || bad "done: rc=$RC calls=$CALLS"
grep -q 'cloud-init status --wait' "$STUB_CALLS" && ok "waits via 'cloud-init status --wait'" || bad "no cloud-init status --wait"
grep -q 'command -v cloud-init' "$STUB_CALLS" && ok "probes for cloud-init before waiting on it" || bad "no presence probe"

scenario '0 ci=2\nup=100' '0 200'
[[ "$RC" == 0 ]] && ok "cloud-init done with recoverable errors (exit 2) counts as finished" || bad "ci=2 rc=$RC"

scenario '0 ci=124\nup=50' '0 ci=0\nup=400' '0 500'
[[ "$RC" == 0 && "$CALLS" == 3 ]] && ok "cloud-init still running (remote timeout) then done -> 0 (3 calls)" || bad "running->done: rc=$RC calls=$CALLS"

scenario '255' '255' '0 ci=0\nup=5' '0 30'
[[ "$RC" == 0 && "$CALLS" == 4 ]] && ok "SSH drops (reboot) then returns -> retried until back, 0" || bad "ssh drop: rc=$RC calls=$CALLS"
grep -q 'SSH unavailable' <<<"$ERR" && ok "logs why it is retrying" || bad "no retry reason logged: $ERR"

scenario '0 ci=0\nup=300' '0 4' '0 ci=0\nup=10' '0 40'
[[ "$RC" == 0 && "$CALLS" == 4 ]] && ok "reboot inside the stability window (uptime reset) -> waits again, 0" || bad "reboot-in-window: rc=$RC calls=$CALLS"
grep -q 'rebooted after cloud-init finished' <<<"$ERR" && ok "names the post-cloud-init reboot" || bad "reboot not named: $ERR"

scenario '0 ci=0\nup=300' '255' '0 ci=0\nup=10' '0 40'
[[ "$RC" == 0 && "$CALLS" == 4 ]] && ok "SSH drops during the stability window -> waits again, 0" || bad "drop-in-window: rc=$RC calls=$CALLS"

scenario '0 ci=absent\nup=100'
[[ "$RC" == 0 && "$CALLS" == 1 ]] && ok "no cloud-init on the guest -> skipped, 0 (1 call)" || bad "absent: rc=$RC calls=$CALLS"

VM_SETTLE_TIMEOUT=1 scenario '255'
[[ "$RC" == 1 ]] && ok "never reachable -> nonzero after VM_SETTLE_TIMEOUT" || bad "timeout rc=$RC"
grep -q 'VM 101 did not settle within 1s' <<<"$ERR" && grep -q 'VM_SETTLE_TIMEOUT' <<<"$ERR" \
  && ok "timeout message names the VM, the bound and the knob" || bad "timeout message: $ERR"

VM_SETTLE_TIMEOUT=1 scenario '0 ci=124\nup=50'
[[ "$RC" == 1 ]] && grep -q 'cloud-init still running' <<<"$ERR" && ok "cloud-init never finishes -> nonzero, says so" || bad "never-finishes rc=$RC: $ERR"

DRY_RUN=1 scenario '0 ci=0\nup=1' '0 2'
[[ "$RC" == 0 && "$CALLS" == 0 ]] && grep -q 'DRY_RUN: vm_wait_settled 101' <<<"$ERR" \
  && ok "DRY_RUN=1 -> logs, touches nothing" || bad "dry run: rc=$RC calls=$CALLS"

(( fails == 0 )) && { echo "vm-settle.selftest: PASS"; exit 0; } || { echo "vm-settle.selftest: FAILED ($fails)"; exit 1; }
