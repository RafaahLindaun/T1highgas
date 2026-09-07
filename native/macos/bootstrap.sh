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
  echo "Go não encontrado. Instale uma versão compatível (CI usa Go 1.17.13)."
  exit 1
fi

mkdir -p "$ROOT/.build"

if [ ! -d "$WG_DIR/.git" ]; then
  git clone --filter=blob:none --no-checkout https://github.com/WireGuard/wireguard-apple.git "$WG_DIR"
fi

git -C "$WG_DIR" fetch --depth 1 origin "$WG_COMMIT"
git -C "$WG_DIR" reset --hard "$WG_COMMIT"
git -C "$WG_DIR" clean -fd

# Patch only build-compatibility issues in the pinned upstream checkout.
# 1) The upstream manifest declares Swift tools 5.3 while using platform
#    constants introduced in PackageDescription 5.5.
# 2) Xcode 26 explicit modules require the BSD integer aliases used by
#    WireGuardKitC.h to be declared before the module header consumes them.
python3 - "$WG_DIR/Package.swift" "$WG_DIR/Sources/WireGuardKitC/WireGuardKitC.h" <<'PY'
from pathlib import Path
import sys

manifest = Path(sys.argv[1])
header = Path(sys.argv[2])

text = manifest.read_text()
old = "// swift-tools-version:5.3"
new = "// swift-tools-version:5.5"
if old in text:
    manifest.write_text(text.replace(old, new, 1))
elif new not in text:
    raise SystemExit("Formato inesperado do Package.swift do WireGuard")

text = header.read_text()
include = "#include <sys/types.h>\n"
if include not in text:
    marker = '#include "key.h"\n'
    if marker not in text:
        raise SystemExit("Formato inesperado do WireGuardKitC.h")
    header.write_text(text.replace(marker, include + "\n" + marker, 1))
PY

xcodegen generate

echo "Projeto gerado: $ROOT/HighGAS.xcodeproj"
echo "Abra no Xcode, selecione seu Apple Developer Team nos targets HighGAS e HighGASTunnel e execute o target HighGAS."
