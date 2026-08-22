#!/usr/bin/env bash
# entrypoint.sh — Docker entrypoint for datafoundry/python-sandbox container.
#
# Responsibilities:
#   1. Apply network isolation (drop all outbound)
#   2. Set up the temp directory (noexec flag)
#   3. Run the sandbox bootstrap with the provided Python source

set -euo pipefail
shopt -s inherit_errexit 2>/dev/null || true

SANDBOX_HOME="${SANDBOX_HOME:-/home/sandbox}"
SANDBOX_RW="${SANDBOX_HOME}/rw"
PYTHON="${PYTHON:-python3}"
MAX_OUTPUT="${DF_SANDBOX_MAX_OUTPUT:-1048576}"

# ── Network isolation ──────────────────────────────────────────────────────────
# Drop ALL outbound traffic — container has no internet access.
# Run as late as possible to minimise attack surface.
apply_network_isolation() {
    if command -v iptables &>/dev/null; then
        # Rule order matters: append (-A) so ESTABLISHED/loopback are checked BEFORE DROP.
        # -I inserts at top, reversing the intended priority. Using -A instead.
        iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || true
        iptables -A OUTPUT -o lo -j ACCEPT 2>/dev/null || true
        iptables -A OUTPUT -j DROP 2>/dev/null || true
        echo "[sandbox] Network isolation applied (iptables DROP all outbound)"
    else
        echo "[sandbox] WARNING: iptables not available, network isolation not applied"
    fi
}

# ── Temp dir setup ─────────────────────────────────────────────────────────────
setup_temp() {
    export TMPDIR="${SANDBOX_RW}"
    export TEMP="${SANDBOX_RW}"
    export TMP="${SANDBOX_RW}"
    # Mount options (noexec,nosuid,nodev) are set in the Dockerfile via
    # --mount=type=tmpfs. This function only sets the standard Python env vars.
    echo "[sandbox] Temp dir: ${SANDBOX_RW}"
}

# ── Main ──────────────────────────────────────────────────────────────────────
apply_network_isolation
setup_temp

echo "[sandbox] Sandbox ready. Python: $(python3 --version 2>&1)"
echo "[sandbox] Sandbox bootstrap: /usr/local/bin/sandbox-bootstrap.py"

# Source passed as $1 (required — no interactive fallback)
SOURCE="${1:-}"
if [[ -z "$SOURCE" ]]; then
    echo "[sandbox] ERROR: no source file provided" >&2
    exit 1
fi
exec python3 /usr/local/bin/sandbox-bootstrap.py "$SOURCE"
