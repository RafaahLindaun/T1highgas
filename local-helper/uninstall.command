#!/bin/zsh
set -euo pipefail

APP_DIR="$HOME/Library/Application Support/HighGAS"
PLIST="$HOME/Library/LaunchAgents/app.highgas.helper.plist"

/bin/launchctl bootout "gui/$UID/app.highgas.helper" >/dev/null 2>&1 || true
rm -f "$PLIST"
rm -rf "$APP_DIR"

echo "HighGAS Helper removido deste Mac."
read -k 1 "?Pressione qualquer tecla para fechar."
echo
