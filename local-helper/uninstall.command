#!/bin/zsh
set -euo pipefail
SYSTEM="/Library/Application Support/HighGAS"
CERTDIR="$SYSTEM/certs"
TOKEN="$SYSTEM/helper.token"
PLIST="/Library/LaunchDaemons/app.highgas.helper.plist"
CI_MODE="${HIGHGAS_CI:-0}"
sudo -v

# Restaura a rede antes de remover qualquer arquivo, mesmo se o helper não responder.
if sudo /bin/test -x "$SYSTEM/highgas-tor"; then
  sudo "$SYSTEM/highgas-tor" down >/dev/null 2>&1 || true
fi
if sudo /bin/test -x "$SYSTEM/highgas-tunnel"; then
  sudo "$SYSTEM/highgas-tunnel" down >/dev/null 2>&1 || true
fi

if sudo /bin/test -s "$TOKEN"; then
  T="$(sudo /bin/cat "$TOKEN" | /usr/bin/tr -d '\r\n ')"
  if sudo /bin/test -s "$CERTDIR/highgas-local-ca.crt"; then
    sudo /usr/bin/curl -fsS --max-time 5 --cacert "$CERTDIR/highgas-local-ca.crt" \
      -X POST -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{}' \
      https://127.0.0.1:37654/v1/disconnect >/dev/null 2>&1 || true
  fi
fi

sudo /bin/launchctl bootout system/app.highgas.helper >/dev/null 2>&1 || true
sudo /bin/rm -f "$PLIST"
sudo /usr/bin/security delete-certificate -c "HighGAS Local Root CA" /Library/Keychains/System.keychain >/dev/null 2>&1 || true
sudo /bin/rm -rf "$SYSTEM" /var/run/highgas

if [[ -d /var/run/wireguard ]]; then
  sudo /usr/bin/find /var/run/wireguard -name 'utun*.sock' -delete >/dev/null 2>&1 || true
fi

/bin/launchctl bootout "gui/$UID/app.highgas.helper" >/dev/null 2>&1 || true
rm -f "$HOME/Library/LaunchAgents/app.highgas.helper.plist" >/dev/null 2>&1 || true

echo "HighGAS removido e configurações de rede restauradas."
if [[ "$CI_MODE" != "1" ]]; then
  read -k 1 '?Pressione qualquer tecla para fechar.'
  echo
fi
