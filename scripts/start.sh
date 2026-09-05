#!/usr/bin/env bash
# ==============================================================================
# OpenProject MCP Companion - Start & Seed Stack
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${ROOT_DIR}"

if [ ! -f .env ]; then
  echo "[start.sh] Creating .env from .env.example..."
  cp .env.example .env
fi

echo "[start.sh] Starting OpenProject docker compose stack..."
docker compose up -d

echo "[start.sh] Running seed script to prepare test data and API token..."
"${SCRIPT_DIR}/seed.sh"

echo "[start.sh] OpenProject MCP test stack is ready!"
