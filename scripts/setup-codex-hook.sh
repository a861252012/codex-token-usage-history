#!/usr/bin/env bash
set -e

SCRIPT_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_PATH="$SCRIPT_DIRECTORY/bin/codex-usage"
CODEX_CONFIG="$HOME/.codex/config.toml"

echo "[設定] 開始配置 Codex APP 與 CLI 整合..."

# 1. 建立命令列全域捷徑
mkdir -p "$HOME/.local/bin"
ln -sf "$BIN_PATH" "$HOME/.local/bin/codex-usage"
echo "[成功] 已建立全域指令捷徑: $HOME/.local/bin/codex-usage"

# 2. 配置 MCP 伺服器至 ~/.codex/config.toml
if [ -f "$CODEX_CONFIG" ]; then
  if grep -q "codex_token_usage" "$CODEX_CONFIG"; then
    echo "[略過] $CODEX_CONFIG 已存在 codex_token_usage MCP 設定。"
  else
    echo "[備份] 備份現有設定至 $CODEX_CONFIG.bak-token-usage"
    cp "$CODEX_CONFIG" "$CODEX_CONFIG.bak-token-usage"

    cat << TOML_BLOCK >> "$CODEX_CONFIG"

# --- Codex Token Usage & Quota Monitor MCP Server ---
[mcp_servers.codex_token_usage]
command = "$BIN_PATH"
args = ["mcp"]
enabled = true
# --- end Codex Token Usage MCP server ---
TOML_BLOCK
    echo "[成功] 已將 codex_token_usage MCP 伺服器寫入 $CODEX_CONFIG"
  fi
else
  echo "[警告] 未找到 $CODEX_CONFIG，略過 MCP 自動寫入"
fi

# 3. 輸出 Shell 整合提示
echo ""
echo "=============================================================================="
echo "[提示] 如需在終端機 (zsh / bash) 即時顯示剩餘額度，可將以下程式碼加入 ~/.zshrc:"
echo ""
echo '  # Codex 剩餘配額 Prompt 整合'
echo '  codex_quota_prompt() {'
echo '    codex-usage prompt 2>/dev/null'
echo '  }'
echo '  RPROMPT="$(codex_quota_prompt) $RPROMPT"'
echo "=============================================================================="
