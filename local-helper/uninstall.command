#!/bin/zsh
set -euo pipefail
SYSTEM="/Library/Application Support/HighGAS"
TOKEN="$SYSTEM/helper.token"
PLIST="/Library/LaunchDaemons/app.highgas.helper.plist"
sudo -v
if sudo /bin/test -s "$TOKEN"; then
  T="$(sudo /bin/cat "$TOKEN"|/usr/bin/tr -d '\r\n ')"
  /usr/bin/curl -fsS --max-time 5 -X POST -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:37654/v1/disconnect >/dev/null 2>&1 || true
fi
sudo /bin/launchctl bootout system/app.highgas.helper >/dev/null 2>&1 || true
sudo /bin/rm -f "$PLIST"
sudo /bin/rm -rf "$SYSTEM" /var/run/highgas
if [[ -d /var/run/wireguard ]]; then
  sudo /usr/bin/find /var/run/wireguard -name 'utun*.sock' -delete >/dev/null 2>&1 || true
fi
/bin/launchctl bootout "gui/$UID/app.highgas.helper" >/dev/null 2>&1 || true
rm -f "$HOME/Library/LaunchAgents/app.highgas.helper.plist" >/dev/null 2>&1 || true
echo "HighGAS removido."
read -k 1 '?Pressione qualquer tecla para fechar.'
echo
