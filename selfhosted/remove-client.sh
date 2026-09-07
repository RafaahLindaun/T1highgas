#!/usr/bin/env bash
set -euo pipefail

WG_IF="${HIGHGAS_WG_IF:-wg0}"
STATE_DIR="/etc/highgas"
WG_CONF="/etc/wireguard/${WG_IF}.conf"
CLIENT_NAME="${1:-}"

if [[ ${EUID} -ne 0 ]]; then
  echo "Execute como root: sudo ./remove-client.sh nome-do-cliente"
  exit 1
fi

if [[ -z "${CLIENT_NAME}" || ! "${CLIENT_NAME}" =~ ^[A-Za-z0-9_-]{1,32}$ ]]; then
  echo "Nome de cliente inválido."
  exit 1
fi

PUB_FILE="${STATE_DIR}/clients/${CLIENT_NAME}.public"
CONF_FILE="${STATE_DIR}/clients/${CLIENT_NAME}.conf"
if [[ ! -r "${PUB_FILE}" ]]; then
  echo "Cliente não encontrado: ${CLIENT_NAME}"
  exit 1
fi

CLIENT_PUBLIC="$(cat "${PUB_FILE}")"
wg set "${WG_IF}" peer "${CLIENT_PUBLIC}" remove || true

TMP="$(mktemp)"
awk -v begin="# BEGIN HIGHGAS PEER ${CLIENT_NAME}" -v end="# END HIGHGAS PEER ${CLIENT_NAME}" '
  $0 == begin {skip=1; next}
  $0 == end {skip=0; next}
  !skip {print}
' "${WG_CONF}" > "${TMP}"
install -m 600 "${TMP}" "${WG_CONF}"
rm -f "${TMP}" "${PUB_FILE}" "${CONF_FILE}"

echo "Cliente removido: ${CLIENT_NAME}"
