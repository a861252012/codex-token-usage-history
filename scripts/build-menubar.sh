#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="$SCRIPT_DIR/bin"
mkdir -p "$BIN_DIR"

echo "[編譯] 開始編譯 MacBook 原生狀態列程式 CodexBar..."
swiftc -O "$SCRIPT_DIR/src/menubar/main.swift" \
  -o "$BIN_DIR/codex-menubar" \
  -framework Cocoa

chmod +x "$BIN_DIR/codex-menubar"
echo "[完成] 已成功編譯產出: $BIN_DIR/codex-menubar"
