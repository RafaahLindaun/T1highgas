#!/usr/bin/env bash
set -euo pipefail

WG_IF="${HIGHGAS_WG_IF:-wg0}"
WG_PORT="${HIGHGAS_PORT:-51820}"
WG_ADDR="${HIGHGAS_SERVER_ADDR:-10.77.0.1/24}"
STATE_DIR="/etc/highgas"
WG_DIR="/etc/wireguard"

if [[ ${EUID} -ne 0 ]]; then
  echo "Execute como root: sudo ./install-server.sh"
  exit 1
fi

if [[ ! -r /etc/os-release ]]; then
  echo "Linux não reconhecido. Este instalador foi preparado para Debian/Ubuntu."
  exit 1
fi

. /etc/os-release
case "${ID:-}" in
  ubuntu|debian) ;;
  *)
    echo "Distribuição não suportada automaticamente: ${ID:-desconhecida}."
    exit 1
    ;;
esac

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y wireguard iptables curl ca-certificates

install -d -m 700 "${WG_DIR}" "${STATE_DIR}" "${STATE_DIR}/clients"

if [[ ! -s "${STATE_DIR}/server.private" ]]; then
  umask 077
  wg genkey | tee "${STATE_DIR}/server.private" | wg pubkey > "${STATE_DIR}/server.public"
fi

PUBLIC_IF="${HIGHGAS_PUBLIC_IF:-$(ip -4 route show default | awk '/default/ {print $5; exit}')}"
if [[ -z "${PUBLIC_IF}" ]]; then
  echo "Não consegui detectar a interface de internet. Defina HIGHGAS_PUBLIC_IF e rode novamente."
  exit 1
fi

ENDPOINT="${HIGHGAS_ENDPOINT:-}"
if [[ -z "${ENDPOINT}" ]]; then
  ENDPOINT="$(curl -4fsS --max-time 5 https://api.ipify.org || true)"
fi
if [[ -z "${ENDPOINT}" ]]; then
  echo "Não consegui descobrir seu IP público. Rode novamente com HIGHGAS_ENDPOINT=IP_OU_DOMINIO."
  exit 1
fi

printf '%s\n' "${ENDPOINT}" > "${STATE_DIR}/endpoint"
printf '%s\n' "${WG_PORT}" > "${STATE_DIR}/port"
printf '%s\n' "${PUBLIC_IF}" > "${STATE_DIR}/public-interface"
chmod 600 "${STATE_DIR}"/*

SERVER_PRIVATE="$(cat "${STATE_DIR}/server.private")"
cat > "${WG_DIR}/${WG_IF}.conf" <<EOF
[Interface]
Address = ${WG_ADDR}
ListenPort = ${WG_PORT}
PrivateKey = ${SERVER_PRIVATE}
SaveConfig = false
PostUp = iptables -A FORWARD -i %i -j ACCEPT; iptables -A FORWARD -o %i -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT; iptables -t nat -A POSTROUTING -o ${PUBLIC_IF} -j MASQUERADE
PostDown = iptables -D FORWARD -i %i -j ACCEPT; iptables -D FORWARD -o %i -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT; iptables -t nat -D POSTROUTING -o ${PUBLIC_IF} -j MASQUERADE
EOF
chmod 600 "${WG_DIR}/${WG_IF}.conf"

cat > /etc/sysctl.d/99-highgas.conf <<'EOF'
net.ipv4.ip_forward=1
EOF
sysctl --system >/dev/null

systemctl enable "wg-quick@${WG_IF}"
systemctl restart "wg-quick@${WG_IF}"

cat <<EOF

HighGAS Server instalado.
Interface: ${WG_IF}
Endpoint: ${ENDPOINT}:${WG_PORT}
Rede VPN: ${WG_ADDR}
Chave pública do servidor: $(cat "${STATE_DIR}/server.public")

Próximo passo:
  sudo ./add-client.sh macbook

IMPORTANTE: libere/encaminhe UDP ${WG_PORT} no roteador para esta máquina, se ela estiver atrás de NAT.
EOF
