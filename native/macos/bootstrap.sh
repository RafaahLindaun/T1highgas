#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h}"
cd "$ROOT"

if ! command -v xcodegen >/dev/null 2>&1; then
  echo "XcodeGen não encontrado. Instale com: brew install xcodegen"
  exit 1
fi

if ! command -v go >/dev/null 2>&1; then
  echo "Go não encontrado. Instale com: brew install go"
  exit 1
fi

xcodegen generate

echo "Projeto gerado: $ROOT/HighGAS.xcodeproj"
echo "Abra no Xcode, selecione seu Apple Developer Team nos targets HighGAS e HighGASTunnel e execute o target HighGAS."
