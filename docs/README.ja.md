# Codex Token & Quota Monitor

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](../LICENSE)

Codex の利用枠、トークン履歴、推定コストをローカルで確認できます。Web、CLI、macOS HUD／メニューバー、MCP に対応。

[正體中文](../README.md) · [English](README.en.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)

## スクリーンショット

デモデータを使用しています。画面は英語と繁体字中国語に対応。

### macOS HUD

左クリックでクォータと本日の推定コストを切り替え。右クリックで表示するクォータ、サイズ、言語を選択できます。

<img src="screenshots/hud.png" alt="macOS HUD" width="112">

<img src="screenshots/hud-menu-en.png" alt="HUD context menu" width="340">

### Web Dashboard

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

既定のデータディレクトリは `~/.codex`。CLI、Dashboard、ネイティブ UI は `CODEX_HOME` で変更できます。利用枠の取得にはローカルの `auth.json` が必要ですが、履歴は利用枠を取得できなくても参照できます。

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
右クリックで「ログイン時に自動起動」をオンにすると、次回ログイン時から起動します。再度クリックで解除できます。プロジェクトを移動したら、設定し直してください。この設定で起動するのは HUD のみで、データ更新サービスは起動しません。
Dashboard の「HUD settings」で更新間隔を設定できます。既定は5秒、1～300の整数のみ。次回更新までに反映されます。

HUD はローカルのキャッシュを読み取ります。利用枠と本日の使用量を更新し続けるには、まず一つのターミナルで次のサービスを起動したままにします。

```bash
./bin/codex-usage dashboard --no-open
```

別のターミナルでネイティブ UI をビルドして起動します。

```bash
bash scripts/build-hud.sh
bash scripts/build-menubar.sh
./bin/codex-usage hud
./bin/codex-menubar &
```

任意：`bash scripts/install.sh` はグローバルショートカットの作成、MCP 設定の追加試行、LaunchAgent plist の生成を行います。LaunchAgent は自動で読み込みません。

<details>
<summary>Node.js</summary>

`node:sqlite` を追加フラグなしで使うには、Node.js 22.x の 22.13 以降、または 23.4 以降が必要です。全テストと Bun ビルドには Bun を使いますが、以下の Node 検証には不要です。

```bash
node -e 'require("node:sqlite")'
npm install
npx tsc
npm run test:node
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

- コストは標準 API 相当の推定値で、サブスクリプションの請求額ではありません。各レコードに価格ソースとバージョンを保存します。Fast、Batch、Flex、cache-write などのサービス別料金は含みません。確認できる料金がないモデルは `fallback` と表示し、そのモデルの公式料金を意味しません。
- 内蔵の Astra、Sol、Terra、Luna 料金では、キャッシュを含む入力が 272,000 トークンを超えると、レコード全体の入力／キャッシュ料金を 2 倍、出力料金を 1.5 倍にします。他の内蔵モデル料金には、この閾値を自動適用しません。カスタム料金とコミュニティ料金は、提供された長文コンテキスト設定に従います。
- 新しい `token_usage_record` と旧形式の累積 `token_count` に対応し、同じ累積スナップショットを重複計上しません。旧バージョンでスキャン済みのファイルは `index --all --force --json` で追加インポートしてください。役割の根拠がない場合は `unknown` のままです。
- アプリや料金の更新では保存済みレコードを自動再計算しません。既存データに新料金を適用するには、自分で `reprice` を実行してください。
- Dashboard の履歴の絞り込みは表と CSV に適用され、出力上限は 5000 件です。CLI の `history` と `report` の `--limit` 上限は 10000 件です。
- 利用枠にはソース、更新時刻、エラーを表示します。スキャン診断はそのプロセスの直近の処理だけを対象とします。
- 画面への接続はローカル限定です。ネイティブ UI と Dashboard は同じ `CODEX_HOME` を使ってください。ネイティブ UI の接続先ポートは現在 10200 固定です。

内蔵料金と長文コンテキストのルールは、2026-09-12 に公式モデル文書で確認しました：[Astra](https://developers.openai.com/api/docs/models/gpt-6-astra) · [Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol) · [Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra) · [Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna) · [GPT-5](https://developers.openai.com/api/docs/models/gpt-5)。

## 開発

```bash
bun test
bun run typecheck
bun run build
```
