#!/bin/zsh
# Упаковывает расширение в zip — отправить друзьям: распаковать и «Загрузить распакованное» в chrome://extensions.
set -euo pipefail
cd "$(dirname "$0")/.."
version=$(grep -o '"version": *"[^"]*"' extension/manifest.json | grep -o '[0-9.]*')
out="wordboss-extension-$version.zip"
rm -f "$out"
(cd extension && zip -qr "../$out" . -x '.*')
echo "$PWD/$out"
