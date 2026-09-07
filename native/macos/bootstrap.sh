#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h}"
WG_DIR="$ROOT/.build/wireguard-apple"
WG_COMMIT="2fec12a6e1f6e3460b6ee483aa00ad29cddadab1"
cd "$ROOT"

if ! command -v xcodegen >/dev/null 2>&1; then
  echo "XcodeGen não encontrado. Instale com: brew install xcodegen"
  exit 1
fi

if ! command -v go >/dev/null 2>&1; then
  echo "Go não encontrado. Instale com: brew install go"
  exit 1
fi

mkdir -p "$ROOT/.build"

if [ ! -d "$WG_DIR/.git" ]; then
  git clone --filter=blob:none --no-checkout https://github.com/WireGuard/wireguard-apple.git "$WG_DIR"
fi

git -C "$WG_DIR" fetch --depth 1 origin "$WG_COMMIT"
git -C "$WG_DIR" reset --hard "$WG_COMMIT"
git -C "$WG_DIR" clean -fd

# Upstream currently declares swift-tools-version 5.3 while its manifest uses
# platform constants introduced in PackageDescription 5.5. Patch only that
# manifest version locally; WireGuard source code remains pinned and untouched.
python3 - "$WG_DIR/Package.swift" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()
old = "// swift-tools-version:5.3"
new = "// swift-tools-version:5.5"
if old in text:
    path.write_text(text.replace(old, new, 1))
elif new not in text:
    raise SystemExit("Formato inesperado do Package.swift do WireGuard")
PY

xcodegen generate

echo "Projeto gerado: $ROOT/HighGAS.xcodeproj"
echo "Abra no Xcode, selecione seu Apple Developer Team nos targets HighGAS e HighGASTunnel e execute o target HighGAS."
