#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h}"
SOURCE="$ROOT/highgas-helper"
APP_DIR="$HOME/Library/Application Support/HighGAS"
BIN="$APP_DIR/highgas-helper"
TOKEN_FILE="$APP_DIR/helper.token"
PLIST="$HOME/Library/LaunchAgents/app.highgas.helper.plist"
LOG="$APP_DIR/helper.log"
ERR="$APP_DIR/helper-error.log"
SITE="https://lowgas.vercel.app"

if [[ ! -f "$SOURCE" ]]; then
  echo "Arquivo highgas-helper não encontrado ao lado deste instalador."
  read -k 1 "?Pressione qualquer tecla para fechar."
  exit 1
fi

mkdir -p "$APP_DIR" "$HOME/Library/LaunchAgents"
chmod 700 "$APP_DIR"
cp "$SOURCE" "$BIN"
chmod 700 "$BIN"

if [[ ! -s "$TOKEN_FILE" ]]; then
  if [[ -x /usr/bin/openssl ]]; then
    /usr/bin/openssl rand -hex 32 > "$TOKEN_FILE"
  else
    printf '%s%s\n' "$(/usr/bin/uuidgen | tr -d '-')" "$(/usr/bin/uuidgen | tr -d '-')" > "$TOKEN_FILE"
  fi
fi
chmod 600 "$TOKEN_FILE"
TOKEN="$(tr -d '\r\n ' < "$TOKEN_FILE")"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>app.highgas.helper</string>
  <key>ProgramArguments</key>
  <array>
    <string>$BIN</string>
    <string>--token-file</string>
    <string>$TOKEN_FILE</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>StandardOutPath</key>
  <string>$LOG</string>
  <key>StandardErrorPath</key>
  <string>$ERR</string>
</dict>
</plist>
PLIST

/usr/bin/plutil -lint "$PLIST" >/dev/null
/bin/launchctl bootout "gui/$UID/app.highgas.helper" >/dev/null 2>&1 || true
/bin/launchctl bootstrap "gui/$UID" "$PLIST"
/bin/launchctl enable "gui/$UID/app.highgas.helper" >/dev/null 2>&1 || true
/bin/launchctl kickstart -k "gui/$UID/app.highgas.helper"

sleep 1
if /usr/bin/curl -fsS --max-time 2 "http://127.0.0.1:37654/v1/health" >/dev/null; then
  echo "HighGAS Helper instalado e ativo."
else
  echo "O helper foi instalado, mas não respondeu ainda. Veja: $ERR"
fi

/usr/bin/open "$SITE/#highgas-helper=$TOKEN"

echo ""
echo "Pronto. O HighGAS foi pareado com este Mac."
echo "Você pode fechar esta janela."
read -k 1 "?Pressione qualquer tecla para fechar."
echo
