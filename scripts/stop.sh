#!/usr/bin/env bash
# ==============================================================================
# OpenProject MCP Companion - Stop Stack
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "[stop.sh] Stopping OpenProject docker compose stack..."
docker compose -f "${ROOT_DIR}/docker-compose.yml" down
echo "[stop.sh] Stack stopped."
