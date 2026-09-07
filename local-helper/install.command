#!/bin/zsh
set -euo pipefail
ROOT="${0:A:h}"
SYSTEM="/Library/Application Support/HighGAS"
TOKEN="$SYSTEM/helper.token"
PLIST="/Library/LaunchDaemons/app.highgas.helper.plist"
SITE="https://lowgas.vercel.app"
for f in highgas-helper highgas-tunnel wireguard-go; do
  [[ -f "$ROOT/$f" ]] || { echo "Pacote incompleto: $f"; read -k 1 '?Fechar'; exit 1; }
done
/usr/bin/xattr -dr com.apple.quarantine "$ROOT" >/dev/null 2>&1 || true
echo "O HighGAS precisa da senha administrativa uma única vez para instalar o motor WireGuard."
sudo -v
/bin/launchctl bootout "gui/$UID/app.highgas.helper" >/dev/null 2>&1 || true
rm -f "$HOME/Library/LaunchAgents/app.highgas.helper.plist" >/dev/null 2>&1 || true
sudo /bin/mkdir -p "$SYSTEM/profiles" /var/run/highgas /var/run/wireguard
for f in highgas-helper highgas-tunnel wireguard-go; do sudo /bin/cp "$ROOT/$f" "$SYSTEM/$f"; done
sudo /usr/sbin/chown -R root:wheel "$SYSTEM"
sudo /bin/chmod 700 "$SYSTEM" "$SYSTEM/profiles" "$SYSTEM/highgas-helper" "$SYSTEM/highgas-tunnel" "$SYSTEM/wireguard-go"
if ! sudo /bin/test -s "$TOKEN"; then
  T="$(/usr/bin/openssl rand -hex 32)"
  printf '%s\n' "$T" | sudo /usr/bin/tee "$TOKEN" >/dev/null
else
  T="$(sudo /bin/cat "$TOKEN"|/usr/bin/tr -d '\r\n ')"
fi
sudo /usr/sbin/chown root:wheel "$TOKEN"
sudo /bin/chmod 600 "$TOKEN"
TMP="$(/usr/bin/mktemp -t highgas).plist"
cat > "$TMP" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>app.highgas.helper</string>
<key>ProgramArguments</key><array><string>$SYSTEM/highgas-helper</string><string>--token-file</string><string>$TOKEN</string></array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ProcessType</key><string>Background</string>
<key>StandardOutPath</key><string>$SYSTEM/helper.log</string><key>StandardErrorPath</key><string>$SYSTEM/helper-error.log</string>
</dict></plist>
PLIST
/usr/bin/plutil -lint "$TMP" >/dev/null
sudo /bin/cp "$TMP" "$PLIST"
rm -f "$TMP"
sudo /usr/sbin/chown root:wheel "$PLIST"
sudo /bin/chmod 644 "$PLIST"
sudo /bin/launchctl bootout system/app.highgas.helper >/dev/null 2>&1 || true
sudo /bin/launchctl bootstrap system "$PLIST"
sudo /bin/launchctl enable system/app.highgas.helper >/dev/null 2>&1 || true
sudo /bin/launchctl kickstart -k system/app.highgas.helper
sleep 1
if /usr/bin/curl -fsS --max-time 3 http://127.0.0.1:37654/v1/health >/dev/null; then
  echo "HighGAS WireGuard ativo."
else
  echo "Serviço instalado; verifique $SYSTEM/helper-error.log se não abrir."
fi
/usr/bin/open "$SITE/#highgas-helper=$T"
echo "Pronto: sem Xcode. O perfil WireGuard fica somente neste Mac e o botão HighGAS liga/desliga o túnel."
read -k 1 '?Pressione qualquer tecla para fechar.'
echo
