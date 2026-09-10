# Codex Token & Quota Monitor

[正體中文](../README.md) · [English](README.en.md) · **日本語** · [简体中文](README.zh-CN.md)

Codex の利用枠、トークン履歴、API 相当の推定コストをローカルで確認するツールです。Web ダッシュボード、CLI、macOS HUD／メニューバー、stdio MCP サーバーが SQLite のデータを共有します。

**OpenAI の公式製品ではありません。** 金額は推定値であり、サブスクリプションの請求額や実際の課金額ではありません。ドキュメントは4言語、画面は **英語と繁体字中国語のみ**に対応しています。日本語 UI は未対応です。

## ログインせずに試す

Bun を用意し、次のコマンドを実行します。

```bash
git clone https://github.com/a861252012/codex-token-usage-history.git
cd codex-token-usage-history
bun install --frozen-lockfile
bun run demo
```

[デモ画面](http://127.0.0.1:10201)を開きます。一時ディレクトリに14日分の架空の履歴と利用枠を生成します。認証情報は不要です。`Ctrl+C` で終了すると、通常の終了処理でデータを削除します。ネイティブ HUD は起動しません。

## 実際の操作画面

動作中のアプリをブラウザーで撮影した画像です。モックアップではありません。`demo@example.com` を含むすべてのアカウント・利用データは架空です。

![英語版ダッシュボード](screenshots/dashboard-en.png)

<details>
<summary>週次レポート、subagent の履歴、狭い画面幅</summary>

![週次レポート](screenshots/weekly-report.png)
![subagent で絞り込んだ履歴](screenshots/subagent-history.png)
<img src="screenshots/dashboard-mobile.png" alt="幅390pxでの表示" width="390">

追加の画像は繁体字中国語 UI です。狭い画面幅のテストはローカルブラウザーで実施したもので、スマートフォンからの LAN 接続を意味しません。

</details>

## 自分の履歴を使う

```bash
./bin/codex-usage doctor
./bin/codex-usage index --all --json
./bin/codex-usage dashboard
```

`doctor` は読み取り専用です。runtime、SQLite の利用可否、データパス、読み取り権限だけを確認し、`auth.json` の内容の読み取り、ログイン確認、ネットワーク接続、`token_usage_history.sqlite` の作成は行いません。機械可読形式は `doctor --json` です。`index --all --json` はローカル索引を作成／更新し、その実行分の診断を返します。データの開始／終了時刻は、その実行で正常に読み取った有効なレコードだけを対象とし、データベース全体の範囲ではありません。

[通常の画面](http://127.0.0.1:10200)を開きます。利用枠の取得にはローカルの有効な `auth.json` が必要です。本ツールはログインを代行しません。利用枠を取得できなくても履歴は参照できます。画面には利用枠の取得元、最後に正常取得した時刻、失敗理由が表示されます。直近2分以内でエラーのない `wham` スナップショットだけをリアルタイムと表示します。キャッシュや fallback はリアルタイムではなく、値がないことは残り100%や無制限を意味しません。

画面の「Dashboard last scan」には、現在のローカルサーバーが直近に実行した索引処理だけが表示されます。内容は scope、データディレクトリ、最後に成功したスキャン、ファイル／レコード／スキップ数、その実行で読み取ったデータ範囲です。別 process の `index --all --json` 診断は引き継がれず、画面を更新しても scope は `all` になりません。全スキャンの証拠には CLI の JSON 出力を使ってください。未変更ファイルは再読込されないため、実行ごとの範囲はデータベース全体の範囲ではありません。scope を確認できない間は完全な履歴とは表示しません。

ブラウザーを自動で開かない場合は `dashboard --no-open --port 10202` を使います。`--port 0` は OS に空きポートを割り当てさせます。実際の URL はターミナルに表示されます。終了は `Ctrl+C` です。

### 画面の使い方

1. 利用枠と今日のトークンを確認します。データがないことは無制限を意味しません。
2. 日次・週次・月次・年次の集計を切り替えます。
3. 履歴セクションでモデル名を検索し、エージェントの役割を選択します。条件は**履歴と CSV のみ**に適用され、概要や集計には影響しません。
4. **View** で Session／Thread／Turn と保存済み価格ソース／バージョンの詳細を開きます。Escape で閉じ、条件のリセットで全履歴に戻ります。
5. CSV は現在の条件で最大5,000件を出力し、各レコードの価格ソース／バージョンも含みます。処理中はボタンを無効化し、空結果には案内、エラーには再試行を表示します。削除・一括変更機能はありません。
6. 利用枠リセットとプラン変更は利用頻度の低いセクションとして初期状態では折りたたまれ、必要なときに展開できます。

## よく使うコマンド

プロジェクトのルートで実行します。

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

集計期間には `daily`、`monthly`、`yearly` も指定できます。`index` と `reprice` はローカル SQLite を変更しますが、`doctor` は変更しません。`index --all --force` はソースファイルを再読み込みし、既存レコードについては明確な証拠がある場合だけ不明な役割を補完します。保存済みコストは再計算せず、再計算は `reprice` が行います。新しい各レコードには実際に使った価格ソースとバージョンが保存され、fallback も明示されます。概要と集計は保存済みレコードからソースを表示し、複数のソース／バージョンがある場合は `mixed` と表示します。復元できない旧レコードは `unknown`／`unknown` と表示し、現在の価格ソースに置き換えません。リセット・プラン変更はスナップショットの差分を記録したもので、完全な監査履歴ではありません。リセットクレジットを消費する機能もありません。

## Node.js と macOS

コアは `node:sqlite` を備えた Node.js にも対応しています。まず環境を確認します。

```bash
node -e 'require("node:sqlite"); console.log("SQLite available")'
npm install
npx tsc
node --no-warnings dist/cli/index.js dashboard
```

テストと `npm run build` には Bun が必要です。Node のみでコンパイルする場合は `npx tsc` を使います。ネイティブ UI には macOS と Xcode Command Line Tools（`swiftc`）が必要です。

```bash
bash scripts/build-hud.sh
bash scripts/build-menubar.sh
./bin/codex-usage hud
./bin/codex-menubar &
```

HUD はドラッグで移動、左クリックで表示指標を切り替え、右クリックで設定します。Pro モードは表示設定であり、利用枠の保証ではありません。ネイティブ画面は欠けている利用枠を「データなし」（orb では `--`）と表示し、残り100%や無制限には置き換えません。メニューにはソース、更新時刻、失敗理由も表示され、cache／fallback／stale はリアルタイムではないことを明示します。HUD は現在の CPU 向けにビルドされます。互換環境では `ARCH=arm64` または `ARCH=x86_64` を指定できます。

任意の統合用 [scripts/install.sh](../scripts/install.sh) は、TypeScript／Swift のコンパイル、`~/.local/bin/codex-usage` の作成、MCP 設定の追加試行、直近7日間の索引、LaunchAgent plist の作成を行います。**LaunchAgent は自動で読み込みません。** ローカル設定を変更するため、実行前に内容を確認してください。デモには不要です。ショートカットを使う場合は `~/.local/bin` を `PATH` に追加します。

## MCP 設定

実際のプロジェクトの絶対パスに置き換えます。

```toml
[mcp_servers.codex_token_usage]
command = "/absolute/path/codex-token-usage-history/bin/codex-usage"
args = ["mcp"]
enabled = true
```

ツール：`get_codex_quota`、`get_codex_usage_history`、`get_codex_settlement_report`、`get_codex_reset_events`、`get_codex_plan_changes`、`get_codex_pricing_info`。

履歴・集計の取得前に全 Session ディレクトリを増分索引します。初回は時間がかかる場合があります。

## データと制限

- コアの既定パスは `~/.codex`。`CODEX_HOME` で変更できますが、ネイティブ UI とインストーラーの一部は `~/.codex` 固定です。
- 入力は `auth.json`、`sessions/`、`archived_sessions/`。履歴は `token_usage_history.sqlite`、利用枠は `codex_quota_snapshot.json`、価格は `pricing.json`／`pricing_cache.json`、HUD 設定は `hud_config.json` に保存します。
- 対応する `token_usage_record` イベントのみを索引します。すべてのログ形式への対応は保証しません。`unsupportedEvents` は未対応の envelope event 数で、ファイル破損数ではありません。`invalidLines`／`invalidRecords` がゼロでなくても、他の有効なレコードは正常に索引される場合があります。
- エージェントの分類は metadata に依存し、証拠が足りない場合は `unknown` です。通常の増分索引は旧レコードの役割を書き換えません。更新後に `index --all --force --json` を実行すると、ソースに明確な証拠がある場合だけ役割を補完します。
- 「Token レコード数」はレコード件数であり、外部 API の呼び出し回数ではありません。
- 利用枠の WHAM エンドポイントは OpenAI に、価格同期は GitHub の LiteLLM データに接続します。完全オフラインではありません。認証やエンドポイントは変わる可能性があります。ソース、最後の正常取得時刻、失敗理由を併せて確認してください。直近2分以内でエラーのない `wham` スナップショットだけがリアルタイムです。キャッシュ／fallback／欠損値は残り100%や無制限を意味しません。リセットクレジット数が未確認の場合は、0ではなく `—` と表示します。
- 価格の優先順位はユーザー設定 → コミュニティキャッシュ → 組み込み値 → fallback。保存済みレコードは実際のソースとバージョンを保持し、復元できない旧データは `unknown`、fallback は汎用推定として表示します。公式の最新価格とみなさないでください。
- コアにサードパーティーの runtime npm 依存はありません。開発には TypeScript と Node 型定義、撮影には別途 Playwright を使います。
- サーバーは loopback のみで待ち受け、Host／Origin／クロスサイト要求を検査します。リバースプロキシで公開しないでください。[SECURITY.md](../SECURITY.md) を参照してください。

## トラブルシューティング

| 症状 | 確認事項 |
| --- | --- |
| 履歴が空 | `doctor` を実行し、`index --all --json` でパス、失敗、無効データ、未対応イベントを確認します。新規追加が0件でも、ファイルが未変更だっただけの場合があります。 |
| 旧レコードがすべて不明な役割 | `index --all --force --json` を実行します。明確な証拠がある場合だけ役割を補完します。 |
| 利用枠がキャッシュ／不明 | ソース、最後の正常取得時刻、失敗理由、ローカル認証、通信状態を確認します。キャッシュ／fallback はリアルタイムではなく、欠損は残り100%や無制限ではありません。 |
| 旧コストのソースが `unknown` | 当時のソースを確実に復元できません。現在の価格で再計算する場合だけ、データを変更する `reprice` を実行します。 |
| ポート使用中 | `dashboard --port 10202 --no-open` または `--port 0` を使います。 |
| `node:sqlite` がない | 上記の確認コマンドを使い、対応する Node または Bun で実行します。 |
| 更新前の画面が残る | 静的ファイルはサーバーがキャッシュします。更新後のディレクトリから再起動して再読み込みします。 |
| フィルターで合計が変わらない | 条件の対象は履歴と CSV のみです。 |
| CSV に全件がない | 上限は条件適用後の5,000件。データベースのバックアップではありません。 |
| スマートフォンから接続できない | loopback 限定です。狭い画面幅の画像は LAN 対応を意味しません。 |

問題の報告には環境、コマンド、機密部分を伏せたエラー、再現手順を添えてください。`auth.json`、完全なデータベース、私的なログはアップロードしないでください。

## 開発と検証

```bash
bun install --frozen-lockfile
bun test
bun run typecheck
bun run build
bash scripts/build-hud.sh
bash scripts/build-menubar.sh
git diff --check
```

過去に実施した検証、環境バージョン、未検証の範囲は、日付付きの[検証記録](verification.md)にまとめています。現在の checkout が合格したと記載する前に、該当する検査を再実行してください。ブラウザー検証は `bun run demo` 起動後、別ターミナルで `node scripts/capture-screenshots.cjs` を実行します。Playwright と Chromium が必要です。別の場所にインストールしている場合は `NODE_PATH` を設定します。このスクリプトは障害を模擬するため、デモ以外には実行しないでください。

コマンドや制限の変更時は各言語の文書も更新してください。[MIT ライセンス](../LICENSE)。
