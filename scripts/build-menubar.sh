#!/usr/bin/env bash
set -e

SCRIPT_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIRECTORY="$SCRIPT_DIRECTORY/bin"
mkdir -p "$BIN_DIRECTORY"

echo "[編譯] 開始編譯 MacBook 原生狀態列程式 CodexBar..."
swiftc -O "$SCRIPT_DIRECTORY/src/menubar/main.swift" \
  -o "$BIN_DIRECTORY/codex-menubar" \
  -framework Cocoa

chmod +x "$BIN_DIRECTORY/codex-menubar"
echo "[完成] 已成功編譯產出: $BIN_DIRECTORY/codex-menubar"
