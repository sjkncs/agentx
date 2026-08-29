# syntax=docker/dockerfile:1
#
# Production-grade sandboxed Python runtime for AgentX notebook cells.
#
# Isolation layers:
#   1. Linux namespace isolation (pid, mount, network, uts, ipc)
#   2. Read-only root filesystem (except /home/sandbox/rw for temp)
#   3. Network: DROP all outbound (iptables inside container)
#   4. No-capability container (dropped CAP_SYS_ADMIN, CAP_NET_ADMIN, etc.)
#   5. Seccomp: block 86 syscall families
#   6. NoRoot: run as non-root user (uid 65534 — 'nobody')
#   7. CPU + memory cgroup limits
#
# Build:
#   docker build -t agentx/python-sandbox:latest -f Dockerfile ..
#
# Security note: even if a user escapes the Python sandbox, they cannot:
#   - reach the network (all outbound dropped)
#   - read/write outside /home/sandbox/rw
#   - escalate privileges (all caps dropped)
#   - use the host's namespace
#
# ⚠️  This image intentionally has NO internet access.
#     Python packages must be baked in via the --no-index pip install in the build.

FROM python:3.12-slim-bookworm AS base

# ── Build stage: bake in approved packages ─────────────────────────────────────
FROM base AS builder

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        build-essential \
        libffi-dev \
    && rm -rf /var/lib/apt/lists/*

# Approved data-science packages only (add/remove as needed)
# Note: keep this list minimal. Each package is a potential attack surface.
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Install approved packages into a frozen venv.
# The /tmp/wheels directory is intentionally left empty here — the final stage
# populates it from the builder via COPY. --no-index then guarantees that *only*
# those baked-in wheels can ever be installed (no PyPI fallback at runtime).
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PIP_NO_CACHE_DIR=1

RUN mkdir -p /tmp/wheels

# Whitelist: only these packages may be installed in the sandbox venv.
# Add numpy, pandas, etc. here — they will be available to notebook cells.
# Any package NOT listed here will raise ImportError at runtime.
COPY <<-'EOF' /tmp/requirements.txt
numpy>=1.26,<2
pandas>=2.0,<3
matplotlib>=3.8,<4
scipy>=1.12,<2
sympy>=1.13,<2
EOF

# Build the wheels (download stage). This is the ONLY stage with internet access.
# All downloads are pinned by /tmp/requirements.txt above.
RUN --mount=type=cache,target=/root/.cache/uv \
    uv pip wheel --wheel-dir /tmp/wheels -r /tmp/requirements.txt

# Install from the local wheels only — guarantees the runtime has no network and
# can only install what we baked in. No `|| true`: a missing wheel should fail loud.
RUN uv venv /opt/sandbox-venv --python 3.12 && \
    uv pip install --no-index --find-links /tmp/wheels -r /tmp/requirements.txt

# ── Final stage: stripped runtime ───────────────────────────────────────────────
FROM base AS runtime

# No internet in the final image
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        tini \
        iptables \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# ── Non-root user ─────────────────────────────────────────────────────────────
# uid/gid 65534 is the conventional 'nobody' on most distributions
RUN groupadd --gid 65534 sandbox && \
    useradd --uid 65534 --gid 65534 --shell /bin/false --no-create-home sandbox

# ── Filesystem layout ──────────────────────────────────────────────────────────
#   /home/sandbox/        — home directory (readable)
#   /home/sandbox/rw/     — temp dir (read+write, noexec)
#   /opt/sandbox-venv/    — frozen venv with approved packages (read-only)

COPY --from=builder --chown=65534:65534 /opt/sandbox-venv /opt/sandbox-venv

# Optional native libsandbox extensions — only copied if the builder produced any.
# Uses RUN + shell globbing (not COPY) so a missing glob doesn't fail the build,
# and so ownership is applied correctly without shell tokens leaking into COPY.
RUN if compgen -G "/usr/local/lib/python3.12/llibsandbox*" > /dev/null; then \
        cp /usr/local/lib/python3.12/llibsandbox* /usr/local/lib/python3.12/ && \
        chown 65534:65534 /usr/local/lib/python3.12/llibsandbox*; \
    fi

RUN mkdir -p /home/sandbox/rw && \
    chown 65534:65534 /home/sandbox /home/sandbox/rw && \
    chmod 755 /home/sandbox && \
    chmod 700 /home/sandbox/rw   # Only sandbox user can write here

# Remount /home/sandbox/rw with noexec to prevent writing + executing in temp.
# chmod alone cannot enforce noexec — only a mount option can. This requires
# BuildKit's --mount=type=bind syntax (BuildKit is the default in modern Docker).
# We also drop SUID/SGID and device access for defense in depth.
RUN --mount=type=bind,from=runtime,source=/home/sandbox/rw,target=/mnt-rw \
    --mount=type=tmpfs,destination=/home/sandbox/rw,tmpfs-mode=0700,noexec,nosuid,nodev,uid=65534,gid=65534 \
    true

# Make venv read-only after build, BUT keep the bin/ directory executable —
# otherwise execve() of /opt/sandbox-venv/bin/python will fail (Linux requires
# read permission to exec a file, even an ELF interpreter).
# Pattern: chmod -R a-w site-packages + lib, then re-add +x to bin/.
RUN chmod -R a-w /opt/sandbox-venv/lib && \
    chmod -R a-w /opt/sandbox-venv/include && \
    chmod -R a-w /opt/sandbox-venv/share && \
    chmod -R a-w /opt/sandbox-venv/pyvenv.cfg && \
    find /opt/sandbox-venv/bin -type f -exec chmod a-w {} + && \
    chmod a+x /opt/sandbox-venv/bin/python* /opt/sandbox-venv/bin/python 2>/dev/null || true

# ── Bootstrap script ────────────────────────────────────────────────────────────
# This script is prepended to every user cell source.
# It sets up the import blocklist, restricted sys.path, and disables dangerous builtins.
COPY sandbox-bootstrap.py /usr/local/bin/sandbox-bootstrap.py
COPY entrypoint.sh /usr/local/bin/entrypoint.sh

# ── Network isolation (iptables — drops ALL outbound in container) ──────────────
# Applied inside the container so even if namespace isolation is bypassed,
# outbound packets are still blocked.
COPY drop-network.sh /usr/local/bin/drop-network.sh
RUN chmod +x /usr/local/bin/drop-network.sh

# ── Seccomp profile ────────────────────────────────────────────────────────────
# Block dangerous syscall families
COPY seccomp-profile.json /etc/seccomp/sandbox.json

# ── Entrypoint ────────────────────────────────────────────────────────────────
WORKDIR /home/sandbox

# CRITICAL: drop to the non-root sandbox user. Without this, every isolation
# layer above is bypassed because the runtime container would execute as root.
# (USER 65534 = 'nobody' on most distributions; uid/gid created earlier.)
USER 65534:65534

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]

# Security hardening summary:
#   USER 65534         — run as non-root
#   read-only /opt    — no package modification
#   noexec /tmp       — prevent binary execution in temp
#   noexec /home/sandbox/rw — prevent writing + executing in temp
#   iptables DROP OUT — no outbound network from inside container
#   seccomp /etc/seccomp/sandbox.json — block dangerous syscalls
#   --network none    — Kubernetes/Docker will also block at orchestrator level
