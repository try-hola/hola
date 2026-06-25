#!/usr/bin/env bash
# Shared helpers for the bin/mcp-setup and bin/vm-* disposable-VM scripts.
# Source this; do not execute it directly.
set -euo pipefail

BIN_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)
ROOT_DIR=$(cd "$BIN_DIR/.." && pwd)

MCP_ENV_FILE="${MCP_ENV_FILE:-$ROOT_DIR/.devcontainer/mcp.env}"
STATE_FILE="${VM_STATE_FILE:-$ROOT_DIR/.devcontainer/.vm-state}"
AUDIT_LOG="${VM_AUDIT_LOG:-$ROOT_DIR/logs/vm-actions.log}"
# Per-VM ephemeral SSH keys live here (gitignored). One keypair per VM, created
# at vm-create time and removed at vm-destroy — never shared, never committed.
KEYS_DIR="${VM_KEYS_DIR:-$ROOT_DIR/.devcontainer/.vm-keys}"

# --- logging ----------------------------------------------------------------
# Colors only when stderr is a TTY, so CI logs stay clean.
if [[ -t 2 ]]; then C_BLUE=$'\e[34m'; C_YEL=$'\e[33m'; C_RED=$'\e[31m'; C_DIM=$'\e[2m'; C_RST=$'\e[0m'
else C_BLUE=; C_YEL=; C_RED=; C_DIM=; C_RST=; fi

log()  { echo "${C_BLUE}[vm]${C_RST} $*" >&2; }
warn() { echo "${C_YEL}[vm] warning:${C_RST} $*" >&2; }
err()  { echo "${C_RED}[vm] error:${C_RST} $*" >&2; }
die()  { err "$@"; exit 1; }

# Append every state-changing action to an audit log (security requirement:
# destructive actions are logged). UTC timestamp, no secrets.
audit() {
  mkdir -p "$(dirname "$AUDIT_LOG")"
  printf '%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${USER:-unknown}" "$*" >> "$AUDIT_LOG"
}

# --- env --------------------------------------------------------------------
# Load .devcontainer/mcp.env if present. Real environment variables (e.g. those
# forwarded from the host by devcontainer containerEnv) always win over the file.
load_env() {
  if [[ -f "$MCP_ENV_FILE" ]]; then
    log "loading $MCP_ENV_FILE"
    while IFS= read -r line || [[ -n "$line" ]]; do
      [[ "$line" =~ ^[[:space:]]*# ]] && continue
      [[ "$line" =~ ^[[:space:]]*$ ]] && continue
      local key=${line%%=*}
      key=${key// /}
      # Don't clobber a value already set in the real environment.
      [[ -n "${!key:-}" ]] && continue
      export "${line?}"
    done < "$MCP_ENV_FILE"
  else
    warn "$MCP_ENV_FILE not found — relying on the current environment."
    warn "run 'bin/mcp-setup' to create it from the template."
  fi
}

require_vars() {
  local missing=()
  for v in "$@"; do [[ -z "${!v:-}" ]] && missing+=("$v"); done
  if (( ${#missing[@]} )); then
    die "missing required env var(s): ${missing[*]} (set them in $MCP_ENV_FILE)"
  fi
}

# --- confirmation for destructive actions -----------------------------------
# Skipped when --yes/-y is passed or FORCE=1; otherwise requires an interactive
# "yes". Non-interactive without --yes refuses, so CI must opt in explicitly.
confirm() {
  local prompt=$1
  # A dry run changes nothing, so never gate it on confirmation.
  if [[ "${DRY_RUN:-0}" == "1" ]]; then return 0; fi
  if [[ "${FORCE:-0}" == "1" || "${ASSUME_YES:-0}" == "1" ]]; then return 0; fi
  if [[ ! -t 0 ]]; then
    die "refusing destructive action without confirmation (non-interactive). Pass --yes or set FORCE=1."
  fi
  read -r -p "${C_YEL}$prompt${C_RST} Type 'yes' to continue: " reply
  [[ "$reply" == "yes" ]] || die "aborted by user."
}

# --- Proxmox REST helpers ----------------------------------------------------
# Auth uses an API token (PVEAPIToken header) — least privilege, never a root
# password. Honors DRY_RUN=1 (prints the request, makes no change).
proxmox_curl() {
  local method=$1 path=$2; shift 2
  require_vars PROXMOX_API_URL PROXMOX_TOKEN_ID PROXMOX_TOKEN_SECRET

  local -a tls=()
  if [[ -n "${PROXMOX_CACERT:-}" ]]; then
    tls=(--cacert "$PROXMOX_CACERT")
  elif [[ "${PROXMOX_TLS_INSECURE:-0}" == "1" ]]; then
    warn "TLS verification disabled (PROXMOX_TLS_INSECURE=1) — lab use only."
    tls=(--insecure)
  fi

  if [[ "${DRY_RUN:-0}" == "1" && "$method" != "GET" ]]; then
    log "DRY_RUN: $method ${PROXMOX_API_URL}/api2/json${path} $*"
    echo '{"data":"dry-run"}'
    return 0
  fi

  curl -fsS -X "$method" "${tls[@]}" \
    -H "Authorization: PVEAPIToken=${PROXMOX_TOKEN_ID}=${PROXMOX_TOKEN_SECRET}" \
    "${PROXMOX_API_URL}/api2/json${path}" "$@"
}

# Convenience: extract .data from a Proxmox response with jq.
pve_data() { jq -r '.data'; }

# --- shared VM state (which VM the helpers act on by default) ----------------
state_get() { [[ -f "$STATE_FILE" ]] && grep -E "^$1=" "$STATE_FILE" | tail -1 | cut -d= -f2- || true; }
state_set() {
  mkdir -p "$(dirname "$STATE_FILE")"; touch "$STATE_FILE"
  local tmp; tmp=$(mktemp)
  grep -vE "^$1=" "$STATE_FILE" > "$tmp" || true
  echo "$1=$2" >> "$tmp"
  mv "$tmp" "$STATE_FILE"
}
state_clear() { rm -f "$STATE_FILE"; }

# Resolve the target VMID: explicit $1 > --vmid arg already parsed into VM_ID >
# the current VM recorded in state.
resolve_vmid() {
  local vmid="${1:-${VM_ID:-}}"
  [[ -z "$vmid" ]] && vmid=$(state_get VM_ID)
  [[ -z "$vmid" ]] && die "no VM id given and none in state ($STATE_FILE). Run bin/vm-create first or pass --vmid."
  echo "$vmid"
}

node() { echo "${PROXMOX_NODE:?PROXMOX_NODE not set}"; }

# --- SSH helpers -------------------------------------------------------------
# Resolve a VM's private IPv4 via the QEMU guest agent. An explicit VM_SSH_HOST
# (or recorded state) always wins. Returns empty if the agent isn't answering
# yet (caller polls). Never used in DRY_RUN — callers short-circuit first.
resolve_vm_ip() {
  local vmid=$1 node=$2
  if [[ -n "${VM_SSH_HOST:-}" ]]; then echo "$VM_SSH_HOST"; return 0; fi
  local saved; saved=$(state_get VM_IP)
  if [[ -n "$saved" ]]; then echo "$saved"; return 0; fi
  proxmox_curl GET "/nodes/$node/qemu/$vmid/agent/network-get-interfaces" 2>/dev/null \
    | jq -r '.data.result[]? | select(.name != "lo")
             | .["ip-addresses"][]? | select(.["ip-address-type"] == "ipv4")
             | .["ip-address"]' 2>/dev/null \
    | grep -vE '^(127\.|169\.254\.)' | head -1 || true
}

# The per-VM private key path: explicit VM_SSH_KEY > recorded state > default.
vm_key_path() {
  local vmid=$1 k="${VM_SSH_KEY:-$(state_get VM_SSH_KEY)}"
  [[ -n "$k" ]] && { echo "$k"; return 0; }
  echo "$KEYS_DIR/$vmid"
}

# Populate the global SSH_OPTS array for a given key: per-VM key only, trust on
# first use, fail fast, and keep known_hosts out of the developer's $HOME.
SSH_OPTS=()
ssh_opts() {
  local key=$1
  mkdir -p "$KEYS_DIR"
  SSH_OPTS=(
    -i "$key"
    -o IdentitiesOnly=yes
    -o StrictHostKeyChecking=accept-new
    -o UserKnownHostsFile="$KEYS_DIR/known_hosts"
    -o ConnectTimeout=10
    -o BatchMode=yes
  )
}

# A stable per-VM ssh alias (e.g. `hola bootstrap --host hola-vm-101`).
vm_alias() { echo "hola-vm-$1"; }

# --- ~/.ssh/config bridge ----------------------------------------------------
# `hola bootstrap` (and `vm-connect`/tunnels) shell out to the SYSTEM ssh, which
# reads ~/.ssh/config. We write a delimited per-VM block so a plain
# `ssh <alias>` / `hola bootstrap --host <alias>` uses the ephemeral key with no
# extra flags. Idempotent; removed by vm-destroy.
SSH_CONFIG_FILE="${SSH_CONFIG_FILE:-$HOME/.ssh/config}"
ssh_config_marker() { echo "hola vm-e2e $1"; }

write_ssh_config() {
  local vmid=$1 ip=$2 user=$3 key=$4 alias; alias=$(vm_alias "$vmid")
  remove_ssh_config "$vmid"   # replace any stale block
  mkdir -p "$(dirname "$SSH_CONFIG_FILE")"; chmod 700 "$(dirname "$SSH_CONFIG_FILE")"
  touch "$SSH_CONFIG_FILE"; chmod 600 "$SSH_CONFIG_FILE"
  {
    echo "# >>> $(ssh_config_marker "$vmid") >>>"
    echo "Host $alias $ip"
    echo "  HostName $ip"
    echo "  User $user"
    echo "  IdentityFile $key"
    echo "  IdentitiesOnly yes"
    echo "  StrictHostKeyChecking accept-new"
    echo "  UserKnownHostsFile $KEYS_DIR/known_hosts"
    echo "# <<< $(ssh_config_marker "$vmid") <<<"
  } >> "$SSH_CONFIG_FILE"
  echo "$alias"
}

remove_ssh_config() {
  local vmid=$1 m; m=$(ssh_config_marker "$vmid")
  [[ -f "$SSH_CONFIG_FILE" ]] || return 0
  local tmp; tmp=$(mktemp)
  sed "/# >>> ${m} >>>/,/# <<< ${m} <<</d" "$SSH_CONFIG_FILE" > "$tmp" && mv "$tmp" "$SSH_CONFIG_FILE"
}
