#!/usr/bin/env bash
set -e

SCRIPT_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_EXECUTABLE="$SCRIPT_DIRECTORY/bin/codex-hud"

echo "[編譯] 開始編譯 MacBook 原生置頂懸浮列程式 CodexHud..."
swiftc \
  -O \
  -target arm64-apple-macos12.0 \
  -framework Cocoa \
  "$SCRIPT_DIRECTORY/src/floating-hud/main.swift" \
  -o "$OUTPUT_EXECUTABLE"

chmod +x "$OUTPUT_EXECUTABLE"
echo "[完成] 已成功編譯產出: $OUTPUT_EXECUTABLE"
