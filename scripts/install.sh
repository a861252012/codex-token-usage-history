#!/usr/bin/env bash
set -e

SCRIPT_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SCRIPT_DIRECTORY"

echo "=============================================================================="
echo " [安裝] 開始安裝與整合 Codex Token 額度與消耗歷史監控系統"
echo "=============================================================================="

# 1. 編譯專案 TypeScript
echo ""
echo "[步驟 1/5] 編譯專案程式碼..."
if command -v bun >/dev/null 2>&1; then
  bun build src/cli/index.ts --target node --outdir dist/cli
  bun build src/server/app.ts --target node --outdir dist/server
  bun build src/mcp/server.ts --target node --outdir dist/mcp
else
  npx tsc
fi
echo "[完成] TypeScript 模組編譯完成。"

# 2. 編譯 MacBook 原生狀態列與置頂懸浮球程式
echo ""
echo "[步驟 2/5] 編譯 MacBook 原生狀態列程式 (CodexBar) 與置頂懸浮球 (CodexHud)..."
bash "$SCRIPT_DIRECTORY/scripts/build-menubar.sh"
bash "$SCRIPT_DIRECTORY/scripts/build-hud.sh"

# 3. 配置 MCP 伺服器與指令捷徑
echo ""
echo "[步驟 3/5] 設定 Codex APP 與 CLI 整合..."
bash "$SCRIPT_DIRECTORY/scripts/setup-codex-hook.sh"

# 4. 執行初次增量索引
echo ""
echo "[步驟 4/5] 建立初次 Token 消耗資料庫索引..."
"$SCRIPT_DIRECTORY/bin/codex-usage" index --days 7

# 5. 建立 LaunchAgent 服務設定檔範本
echo ""
echo "[步驟 5/5] 產生 macOS 背景服務 (LaunchAgent) 設定檔..."
PLIST_DIRECTORY="$HOME/Library/LaunchAgents"
mkdir -p "$PLIST_DIRECTORY"
PLIST_PATH="$PLIST_DIRECTORY/com.codex.token-usage-monitor.plist"

xml_escape() {
  local s="$1"
  s="${s//&/&amp;}"
  s="${s//</&lt;}"
  s="${s//>/&gt;}"
  s="${s//\"/&quot;}"
  s="${s//\'/&apos;}"
  printf '%s' "$s"
}

ESCAPED_BIN="$(xml_escape "$SCRIPT_DIRECTORY/bin/codex-usage")"
ESCAPED_LOG="$(xml_escape "$HOME/.codex/token-usage-server.log")"

cat << PLIST_EOF > "$PLIST_PATH"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.codex.token-usage-monitor</string>
  <key>ProgramArguments</key>
  <array>
    <string>$ESCAPED_BIN</string>
    <string>dashboard</string>
    <string>--port</string>
    <string>10200</string>
    <string>--no-open</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$ESCAPED_LOG</string>
  <key>StandardErrorPath</key>
  <string>$ESCAPED_LOG</string>
</dict>
</plist>
PLIST_EOF

echo "[完成] LaunchAgent 服務設定已建立: $PLIST_PATH"
echo "  如需開機自動啟動 Web 儀表板背景服務，請執行:"
echo "    launchctl load $PLIST_PATH"

echo ""
echo "=============================================================================="
echo " [驗證] 執行狀態檢視："
echo "=============================================================================="
"$SCRIPT_DIRECTORY/bin/codex-usage" status

echo ""
echo "=============================================================================="
echo " [安裝完成] 所有功能已就緒！"
echo "  1. 終端機狀態查看: codex-usage"
echo "  2. 啟動全方位儀表板: codex-usage dashboard"
echo "  3. 啟動置頂懸浮球: codex-usage hud"
echo "  4. 查詢歷史流水帳: codex-usage history --limit 50"
echo "  5. 啟動 MacBook 狀態列小圖示: $SCRIPT_DIRECTORY/bin/codex-menubar &"
echo "  6. Codex APP / CLI 原生對話查詢: 詢問「目前剩餘額度」或「今日 Token 消耗」即可"
echo "=============================================================================="
