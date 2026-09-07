#!/usr/bin/env bash
set -euo pipefail

WG_IF="${HIGHGAS_WG_IF:-wg0}"
STATE_DIR="/etc/highgas"

echo "HighGAS Server"
echo "=============="
if systemctl is-active --quiet "wg-quick@${WG_IF}"; then
  echo "Serviço: ATIVO"
else
  echo "Serviço: PARADO"
fi

if [[ -r "${STATE_DIR}/endpoint" && -r "${STATE_DIR}/port" ]]; then
  echo "Endpoint: $(cat "${STATE_DIR}/endpoint"):$(cat "${STATE_DIR}/port")"
fi

if command -v wg >/dev/null 2>&1; then
  echo
  wg show "${WG_IF}" || true
fi
