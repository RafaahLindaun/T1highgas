#!/usr/bin/env bash
set -euo pipefail

WG_IF="${HIGHGAS_WG_IF:-wg0}"
STATE_DIR="/etc/highgas"
WG_DIR="/etc/wireguard"
CLIENT_NAME="${1:-}"

if [[ ${EUID} -ne 0 ]]; then
  echo "Execute como root: sudo ./add-client.sh nome-do-cliente"
  exit 1
fi

if [[ -z "${CLIENT_NAME}" || ! "${CLIENT_NAME}" =~ ^[A-Za-z0-9_-]{1,32}$ ]]; then
  echo "Nome inválido. Use apenas letras, números, _ ou - (máx. 32 caracteres)."
  exit 1
fi

for file in "${STATE_DIR}/server.public" "${STATE_DIR}/endpoint" "${STATE_DIR}/port" "${WG_DIR}/${WG_IF}.conf"; do
  if [[ ! -r "${file}" ]]; then
    echo "Servidor HighGAS ainda não está preparado. Rode install-server.sh primeiro."
    exit 1
  fi
done

CLIENT_CONF="${STATE_DIR}/clients/${CLIENT_NAME}.conf"
CLIENT_PUB_FILE="${STATE_DIR}/clients/${CLIENT_NAME}.public"
if [[ -e "${CLIENT_CONF}" ]]; then
  echo "O cliente ${CLIENT_NAME} já existe: ${CLIENT_CONF}"
  exit 1
fi

USED_IPS="$(grep -hE '^Address = 10\.77\.0\.[0-9]+/32$' "${STATE_DIR}/clients/"*.conf 2>/dev/null || true)"
CLIENT_OCTET=""
for octet in $(seq 2 254); do
  if ! grep -q "10.77.0.${octet}/32" <<<"${USED_IPS}"; then
    CLIENT_OCTET="${octet}"
    break
  fi
done
if [[ -z "${CLIENT_OCTET}" ]]; then
  echo "Não há endereços livres na rede 10.77.0.0/24."
  exit 1
fi
CLIENT_IP="10.77.0.${CLIENT_OCTET}"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT
umask 077
wg genkey > "${TMP_DIR}/client.private"
wg pubkey < "${TMP_DIR}/client.private" > "${TMP_DIR}/client.public"
wg genpsk > "${TMP_DIR}/client.psk"

CLIENT_PRIVATE="$(cat "${TMP_DIR}/client.private")"
CLIENT_PUBLIC="$(cat "${TMP_DIR}/client.public")"
CLIENT_PSK="$(cat "${TMP_DIR}/client.psk")"
SERVER_PUBLIC="$(cat "${STATE_DIR}/server.public")"
ENDPOINT="$(cat "${STATE_DIR}/endpoint")"
PORT="$(cat "${STATE_DIR}/port")"

cat > "${CLIENT_CONF}" <<EOF
[Interface]
PrivateKey = ${CLIENT_PRIVATE}
Address = ${CLIENT_IP}/32
DNS = 1.1.1.1, 1.0.0.1

[Peer]
PublicKey = ${SERVER_PUBLIC}
PresharedKey = ${CLIENT_PSK}
AllowedIPs = 0.0.0.0/0
Endpoint = ${ENDPOINT}:${PORT}
PersistentKeepalive = 25
EOF
printf '%s\n' "${CLIENT_PUBLIC}" > "${CLIENT_PUB_FILE}"
chmod 600 "${CLIENT_CONF}" "${CLIENT_PUB_FILE}"

cat >> "${WG_DIR}/${WG_IF}.conf" <<EOF

# BEGIN HIGHGAS PEER ${CLIENT_NAME}
[Peer]
PublicKey = ${CLIENT_PUBLIC}
PresharedKey = ${CLIENT_PSK}
AllowedIPs = ${CLIENT_IP}/32
# END HIGHGAS PEER ${CLIENT_NAME}
EOF

wg set "${WG_IF}" peer "${CLIENT_PUBLIC}" preshared-key "${TMP_DIR}/client.psk" allowed-ips "${CLIENT_IP}/32"

cat <<EOF
Cliente criado: ${CLIENT_NAME}
IP VPN: ${CLIENT_IP}
Perfil: ${CLIENT_CONF}

Copie apenas esse arquivo .conf para o dispositivo cliente e depois apague a cópia de transporte.
A chave privada do cliente nunca precisa ir para GitHub, Neon ou Vercel.
EOF
