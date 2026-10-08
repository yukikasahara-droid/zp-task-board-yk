# ZPタスクボード

Slack `#zp-status-kasahara` で出した作業指示を一覧で見るための、パスワード付き静的サイトです。
（以前は Notion「Slack指示タスク（zp-status-kasahara）」で管理していたもの。2026-10-07 に全70件＋その後の新着4件を移行済み）

## 使い方（メンバー向け）

| やりたいこと | やり方 |
|---|---|
| タスクを頼む | `#zp-status-kasahara` で **@担当者 にメンション**して内容を書く（「◯/◯まで」「今週中」など期限も書くと期限として登録されます） |
| 着手した | 元メッセージの**スレッド**に「着手」と返信 |
| 終わった | 元メッセージの**スレッド**に「完了」と返信 |
| 一覧を見る | サイトを開いて共有パスワードを入力（「この端末で記憶する」で次回から入力不要） |

サイトへの反映は平日 9時・18時ごろ（Claude の定期実行）です。サイト上での編集はできません。入口はすべて Slack です。

## 仕組み

```
Slack #zp-status-kasahara ──(平日9時・18時)──▶ Claude ルーティン
                                                   │ scripts/tasks.mjs apply で追加・更新
                                                   ▼
                                     data/tasks.enc.json（暗号化済み）を main に push
                                                   │
                                                   ▼
                                     GitHub Pages ──▶ ブラウザでパスワード入力して復号・表示
```

- リポジトリは公開ですが、タスクの中身は **AES-GCM で暗号化した `data/tasks.enc.json` だけ**が置かれます。パスワードはリポジトリのどこにも書きません。
- 画面は `index.html` ＋ `assets/`（ビルド不要の素の HTML/JS/CSS）。
- 暗号化・復号のコードは `assets/crypto.js` をブラウザと Node.js で共用しています。

## データを手で直したいとき

Node.js 20 以上が必要です。

```bash
export TASKBOARD_PASSWORD='共有パスワード'
node scripts/tasks.mjs decrypt    # data/tasks.json（平文）に書き出す ※git には入らない
# data/tasks.json をエディタで編集
node scripts/tasks.mjs encrypt    # 暗号化して data/tasks.enc.json を更新
git add data/tasks.enc.json && git commit -m "タスクを手動修正" && git push
```

その他のコマンド:

```bash
node scripts/tasks.mjs summary          # 最新のSlack TS と未完了タスク一覧
node scripts/tasks.mjs apply changes.json  # 追加・更新をまとめて反映（ルーティンが使う）
node scripts/tasks.mjs selftest         # 動作確認
```

タスク1件の形式:

```json
{
  "id": "1791165154.620319",       // Slack のメッセージTS（重複防止のキー）
  "title": "機体イシューを網羅的に見られるマトリクス作成",
  "body": "元メッセージの本文",
  "assignees": ["笠原 雄希"],
  "status": "未着手",              // 未着手 / 進行中 / 完了
  "assignedOn": "2026-10-05",      // 指示日
  "due": null,                     // 期限（読み取れなければ null）
  "completedOn": null,             // 完了日
  "slackUrl": "https://orylab.slack.com/archives/C06FZL1TD99/p1791165154620319"
}
```

## パスワードを変えるとき

```bash
export TASKBOARD_PASSWORD='今のパスワード'
node scripts/tasks.mjs decrypt
export TASKBOARD_PASSWORD='新しいパスワード'
node scripts/tasks.mjs encrypt
git add data/tasks.enc.json && git commit -m "パスワード変更" && git push
rm data/tasks.json
```

あわせて Claude ルーティンの設定（`docs/routine-prompt.md` の内容で登録したもの）のパスワードも差し替えてください。

## 初回セットアップ（済んでいれば不要）

1. GitHub の **Settings → Pages** で Source を「Deploy from a branch」、Branch を `main` / `(root)` にして Save
2. 数分後に `https://yukikasahara-droid.github.io/zp-task-board-yk/` で表示されます
