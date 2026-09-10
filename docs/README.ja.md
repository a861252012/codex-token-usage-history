# Codex Token & Quota Monitor

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](../LICENSE)

Codex の利用枠、トークン履歴、推定コストをローカルで確認できます。Web、CLI、macOS HUD／メニューバー、MCP に対応。

[正體中文](../README.md) · [English](README.en.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)

## スクリーンショット

デモデータを使用しています。画面は英語と繁体字中国語に対応。

![Dashboard](screenshots/dashboard-en.png)

<details>
<summary>週次レポート、履歴、狭い画面幅</summary>

![Weekly report](screenshots/weekly-report.png)
![History](screenshots/subagent-history.png)
![Record detail](screenshots/record-detail-firefox.png)
<img src="screenshots/dashboard-mobile.png" alt="Dashboard 390px" width="390">

</details>

## クイックスタート

Bun が必要です。まずデモを起動します。

```bash
git clone https://github.com/a861252012/codex-token-usage-history.git
cd codex-token-usage-history
bun install --frozen-lockfile
bun run demo
```

開く [http://127.0.0.1:10201](http://127.0.0.1:10201) · Ctrl+C

### 自分の Codex 履歴を使う

```bash
./bin/codex-usage dashboard
```
起動時に全履歴を自動で取り込み、その後は差分を更新します。手動のインデックス作成は不要です。

開く [http://127.0.0.1:10200](http://127.0.0.1:10200)

既定のデータディレクトリは `~/.codex`。コアは `CODEX_HOME` で変更できます。利用枠の取得にはローカルの `auth.json` が必要ですが、履歴は利用枠を取得できなくても参照できます。

## コマンド

| 目的 | コマンド |
| --- | --- |
| 読み取り専用の環境診断 | `./bin/codex-usage doctor`（または `doctor --json`） |
| 利用枠と今日の利用量 | `./bin/codex-usage status --json` |
| リアルタイム表示 | `./bin/codex-usage live` |
| 直近50件 | `./bin/codex-usage history --limit 50` |
| subagent の履歴 | `./bin/codex-usage history --role subagent --json` |
| 役割不明の履歴 | `./bin/codex-usage history --role unknown --json` |
| CSV 出力 | `./bin/codex-usage history --csv --limit 5000` |
| 週次集計 | `./bin/codex-usage report --period weekly` |
| 観測したリセット／プラン変更 | `./bin/codex-usage resets` / `./bin/codex-usage plans` |
| 全履歴のスキャンと診断 | `./bin/codex-usage index --all --json` |
| 旧ファイルの強制再読み取り | `./bin/codex-usage index --all --force --json` |
| 価格表の確認／更新 | `./bin/codex-usage pricing` / `./bin/codex-usage pricing update` |
| 保存済み推定コストの再計算 | `./bin/codex-usage reprice` |
| シェル表示／ヘルプ | `./bin/codex-usage prompt` / `./bin/codex-usage --help` |

## macOS

Xcode Command Line Tools が必要です。HUD はドラッグで移動、左クリックで指標を切り替え、右クリックで設定します。
右クリックで「ログイン時に自動起動」をオンにすると、次回ログイン時から起動します。再度クリックで解除できます。プロジェクトを移動したら、設定し直してください。
Dashboard の「HUD settings」で更新間隔を設定できます。既定は5秒、1～300の整数のみ。次回更新までに反映されます。

```bash
bash scripts/build-hud.sh
bash scripts/build-menubar.sh
./bin/codex-usage hud
./bin/codex-menubar &
```

任意：`bash scripts/install.sh` はグローバルショートカットの作成、MCP 設定の追加試行、LaunchAgent plist の生成を行います。LaunchAgent は自動で読み込みません。

<details>
<summary>Node.js</summary>

`node:sqlite` 対応の Node.js が必要です。テストと Bun ビルドには Bun を使います。

```bash
node -e 'require("node:sqlite")'
npm install
npx tsc
node --no-warnings dist/cli/index.js dashboard
```

</details>

## MCP

プロジェクトの絶対パスに置き換えます。

```toml
[mcp_servers.codex_token_usage]
command = "/absolute/path/codex-token-usage-history/bin/codex-usage"
args = ["mcp"]
enabled = true
```

`get_codex_quota` · `get_codex_usage_history` · `get_codex_settlement_report` · `get_codex_reset_events` · `get_codex_plan_changes` · `get_codex_pricing_info`

## 使い方の補足

- コストは API 相当の推定値です。各レコードに価格ソースとバージョンを保存します。
- 履歴の絞り込みは表と CSV に適用され、出力上限は 5000 件です。
- 役割を判定できない場合は `unknown`。`index --all --force --json` でソースを再読込できます。`reprice` は保存済みコストを再計算します。
- 利用枠にはソース、更新時刻、エラーを表示します。スキャン診断はそのプロセスの直近の処理だけを対象とします。
- 画面への接続はローカル限定です。ネイティブ UI とインストーラーの一部パスは `~/.codex` 固定です。

## 開発

```bash
bun test
bun run typecheck
bun run build
```
