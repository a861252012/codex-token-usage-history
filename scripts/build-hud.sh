#!/usr/bin/env bash
set -e

SCRIPT_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_EXECUTABLE="${OUTPUT_EXECUTABLE:-$SCRIPT_DIRECTORY/bin/codex-hud}"

TARGET_ARCH="${ARCH:-$(uname -m)}"
TARGET_FLAGS=()

case "$TARGET_ARCH" in
  x86_64)
    TARGET_FLAGS=(-target "x86_64-apple-macos12.0")
    ;;
  arm64|aarch64)
    TARGET_FLAGS=(-target "arm64-apple-macos12.0")
    ;;
  *)
    TARGET_FLAGS=()
    ;;
esac

echo "[編譯] 開始編譯 MacBook 原生置頂懸浮列程式 CodexHud (${TARGET_ARCH})..."
swiftc \
  -O \
  "${TARGET_FLAGS[@]}" \
  -framework Cocoa \
  "$SCRIPT_DIRECTORY/src/floating-hud/main.swift" \
  -o "$OUTPUT_EXECUTABLE"

chmod +x "$OUTPUT_EXECUTABLE"
echo "[完成] 已成功編譯產出: $OUTPUT_EXECUTABLE"
