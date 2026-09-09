# 貢獻指南 (Contributing Guidelines)

感謝您對 `codex-token-usage-history` 開源專案的關注與貢獻！  
本專案致力於打造極致簡潔、高效能且品味卓越的 OpenAI / Codex 開發者工具鏈。

為了維護專案的一致品質，所有 Pull Request (PR) 均須遵守以下工程準則：

---

## 1. 核心哲學 (Core Philosophy)

1. **品味 (Good Taste)**：
   - 消除邊界條件優於增加條件分支。
   - 杜絕過度工程與不必要的相依套件。專案堅持**零外部 npm 套件依賴**，採用 Node.js 22+ / Bun 內建之 SQLite 與 HTTP 模組。
2. **絕不破壞使用者空間 (Never Break Userspace)**：
   - 向下相容性至關重要，任何功能改版不得影響既有使用者的工作流程。
3. **務實主義 (Pragmatism)**：
   - 程式碼必須服務實際開發需求，追求清晰易讀與高效執行。

---

## 2. 命名與編程規範 (Coding Standards)

1. **嚴禁無意義的縮寫 (No Cryptic Abbreviations)**：
   - 禁止使用如 `r`, `s`, `win`, `d`, `idx`, `add`, `p5`, `pw`, `rem`, `snap`, `req`, `res`, `pct` 等單字母或模糊縮寫。
   - 一律展開為語意完整之名詞或動詞片語（例如：`tokenRecord`, `usageSummary`, `quotaWindow`, `remainingPercent`, `quotaSnapshot`）。
2. **變數與函數命名**：
   - 變數名稱必須為**名詞**，嚴禁使用 `is/has` 作為布林變數前綴（例如使用 `bunRuntime` 代替 `isBun`，使用 `alertTriggered` 代替 `hasAlert`）。
   - 函數名稱必須以**動詞**起頭（例如 `calculateCost()`, `fetchQuota()`, `renderProgressBar()`）。
3. **運算子規範**：
   - **全面禁止使用 `++` 運算子**，一律使用 `+= 1`。
4. **語言與符號政策**：
   - 程式碼註解、說明文件與終端機輸出文字，一律使用**正體中文（臺澎金馬地區慣用語）**。
   - 專案內部與 commit 訊息**嚴格禁止使用任何表情符號 (Emoji)**，請使用 `[成功]`, `[完成]`, `[錯誤]` 等方括號文字標籤。
5. **資料庫存取標準**：
   - 嚴禁使用 `SELECT *`，SQL 查詢必須明確列出所需欄位以確保效能與查詢計畫穩定度。

---

## 3. 開發與驗證流程

1. **本地測試與建置**：
   ```bash
   # 打包 CLI bundle
   npm run build

   # 編譯 MacBook 原生狀態列與置頂懸浮列
   npm run build:menubar
   npm run build:hud
   ```
2. **驗證指令**：
   ```bash
   bin/codex-usage status --json
   bin/codex-usage prompt
   ```
3. **提交 PR**：
   - 請提供清晰的 PR 描述，說明修改動機與變更範圍。
   - Commit 訊息請使用英文，並遵守 Conventional Commits 格式（如 `feat: ...`, `fix: ...`, `refactor: ...`）。
