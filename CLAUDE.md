# CLAUDE.md — ZPタスクボード

Slack `#zp-status-kasahara` の作業指示を一覧表示する、パスワード付き静的サイト。
**作業を始める前に `docs/HANDOFF.md`（現状・未完了事項・決定事項）を必ず読むこと。**

## 構成（ビルド不要・依存パッケージなし）

| パス | 役割 |
|---|---|
| `index.html` | 画面（パスワード入力 → 一覧） |
| `assets/app.js` | 復号・絞り込み・描画（素の ES Modules） |
| `assets/crypto.js` | PBKDF2-SHA256(600,000回) + AES-GCM。**ブラウザと Node で共用** |
| `assets/style.css` | スタイル（ライト/ダーク対応、スマホ幅対応） |
| `data/tasks.enc.json` | タスクデータ（**暗号文のみ**） |
| `scripts/tasks.mjs` | CLI: `summary` / `apply` / `decrypt` / `encrypt` / `selftest` |
| `docs/routine-prompt.md` | Slack→ボード同期ルーティンのプロンプト控え |

公開: GitHub Pages（main ブランチ / root）→ https://yukikasahara-droid.github.io/zp-task-board-yk/

## 絶対に守ること

- **リポジトリは public。** 平文のタスクデータ（`data/tasks.json`、`changes.json` など）や共有パスワードを、
  コミット・コミットメッセージ・コードコメント・ドキュメント・PR・Issue に**絶対に書かない**。
  `git add -A` の前に `git status` で平文ファイルが含まれていないか確認する。
- パスワードは環境変数 `TASKBOARD_PASSWORD` から読む。値を echo / ログ出力しない。
- `data/tasks.enc.json` は手で編集しない。必ず `scripts/tasks.mjs` 経由で更新する。
- **要件は `docs/REQUIREMENTS.md` が最新**（Slack・サイト編集・カメラの3入口、優先度と前後関係、1タップ完了）。
  現在の「閲覧専用の静的サイト」は第1版で、作り直し中。データベース等の選定はユーザー確認が済むまで実装に入らない。
- ユーザーはメカエンジニアでプログラミング初心者。説明は平易な日本語で。

## よく使うコマンド（Node.js 20 以上）

```bash
node scripts/tasks.mjs selftest                 # 変更後は必ず実行
python3 -m http.server 8765                     # ローカル表示 → http://localhost:8765/
TASKBOARD_PASSWORD=... node scripts/tasks.mjs summary
TASKBOARD_PASSWORD=... node scripts/tasks.mjs apply /tmp/changes.json
```

## データ形式・コード規約

- タスク1件: `{ id, title, body, assignees[], status, assignedOn, due, completedOn, slackUrl }`
  - `id` は Slack メッセージTS（重複防止キー）。`status` は `未着手` / `進行中` / `完了`。日付は `YYYY-MM-DD`（JST）。
  - 項目を増やすときは `scripts/tasks.mjs` の `normalizeTask` / `validateTask` / `selftest` と `assets/app.js` の表示をセットで直す。
- 暗号形式（`v: 1`）を変える場合は、`decryptJson` で旧形式も読めるようにしてから移行する（閲覧者の端末に記憶されたパスワードはそのまま使える）。
- コメント・UI 文言は日本語。外部ライブラリ・ビルドツールは入れない方針（初心者が保守できるように）。
- コミットは小さく、日本語メッセージで。main に直接 push している（PR運用は未導入）。並行作業の注意は `docs/HANDOFF.md` を参照。
