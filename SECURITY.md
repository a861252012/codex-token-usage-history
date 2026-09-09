# 安全性政策與隱私承諾 (Security Policy & Privacy)

本專案 `codex-token-usage-history` 致力於為開發者社群提供透明、安全且高度可信的 Token 監控工具鏈。

---

## 1. 隱私與敏感資訊防護承諾

1. **認證金鑰保護 (Zero Leakage Policy)**：
   - 本工具在讀取 `~/.codex/auth.json` 時，僅擷取存取 OpenAI WHAM 配額端點所需之 Bearer Token 與 Account ID。
   - 認證金鑰**絕不**寫入任何本地 SQLite 資料庫、文字日誌或快取檔案。
   - 認證金鑰**絕不**傳送至任何除 OpenAI 官方端點 (`https://chatgpt.com/backend-api/wham/usage`) 以外的伺服器。
2. **零第三方遙測與零外傳 (No Telemetry, No External Tracking)**：
   - 專案內部無任何第三方追蹤代碼、Google Analytics 或雲端回傳機制。
   - 所有對話 Token 消耗流水帳均 100% 保存在使用者本機的 SQLite 資料庫 (`~/.codex/token_usage_history.sqlite`) 中。
3. **通訊安全**：
   - 本機 Web 儀表板伺服器預設僅監聽 `127.0.0.1` 迴路位址，嚴禁非授權的外網存取。

---

## 2. 支援版本

| 版本 | 支援狀態 |
| :--- | :--- |
| 1.0.x | 支援中 (提供安全性修正) |

---

## 3. 安全漏洞回報

若您在此專案中發現任何潛在的安全性弱點或憑證外洩風險，請不要公開提出 Issue。請透過 GitHub 私人安全性諮詢管道 (Private Security Advisory) 或聯繫專案維護團隊：

- 維護者電子信箱：`a861252012@gmail.com`

我們將於 48 小時內確認問題，並於確認後儘速發布安全性修復版本。
