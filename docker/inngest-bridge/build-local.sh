#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../services/inngest-bridge"
exec docker build -f ../../docker/inngest-bridge/Dockerfile -t agentx/inngest-bridge:latest .
