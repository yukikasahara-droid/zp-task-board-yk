# 引き継ぎメモ（HANDOFF）

クラウド版 Claude Code とデスクトップ版 Claude で並行して作業するための共有メモ。
**作業を始めたら「現在の状況」を確認し、終えたら「作業ログ」に1行追記してコミットすること。**

最終更新: 2026-10-08 夜（クラウド版 Claude Code）
**⚠ 10/8 夜に要件が大きく変わった。まず `docs/REQUIREMENTS.md`（決定事項あり）と `docs/SETUP-GOOGLE.md` を読むこと。**
新方式: データは Google スプレッドシート `1LAMK-h_1b8NNzrDAhmRn9KZKtE7lfRyHwtjpLwyeBsQ`（Drive）。旧方式（暗号化JSON）は新画面の完成まで残す。

---

## 1. 背景と決定事項

- 以前は Notion DB「Slack指示タスク（zp-status-kasahara）」で管理していたが、**Notion アカウントのないメンバーが見られない**ため、静的サイトに移行した。
  - Notion DB: https://app.notion.com/p/b3cbe05be0894ea7ac43c1a932e9f585 （削除せず残置。今後は更新しない）
  - Notion へ書き込んでいた旧ルーティン「Slack指示タスク→Notion登録（朝9時／夕18時）」は 2026-09-15 から無効のまま。
- **入口は Slack・サイト・カメラの3つに変更（10/8 夜）。最新の要件は [`REQUIREMENTS.md`](REQUIREMENTS.md)。以下は第1版（閲覧専用）当時の決定。**
- 第1版の入口は Slack のみ。サイトは閲覧専用。
  - 依頼: `#zp-status-kasahara`（チャンネルID `C06FZL1TD99`、private）で @担当者 にメンション
  - 着手: 元メッセージのスレッドに「着手」 → `進行中`
  - 完了: 元メッセージのスレッドに「完了」 → `完了`
- **公開方法: public リポジトリ + GitHub Pages + クライアント側暗号化**（ユーザーが選択）。
  - 無料プランでは private リポジトリの Pages が使えないため。取引先名・自治体名を含むので平文公開はしない。
  - 共有パスワードを知っている人だけがブラウザで復号できる。パスワードはリポジトリに置かない。
  - 不採用案: パスワードなし公開（情報漏えい）／Cloudflare Access（設定負担が大きい）。
- 同期は Claude Code のルーティン（LLM がメッセージ要約・期限推定を行う）。Slack App を新規に作る案は、ワークスペース管理者の承認が要るため見送り。

## 2. 現在の状況

### 完了
- [x] サイト本体（パスワード画面、件数サマリ、担当者・状態・キーワード絞り込み、期限切れ/期限間近の強調、Slack リンク、スマホ・ダークモード対応）
- [x] `scripts/tasks.mjs`（summary / apply / decrypt / encrypt / selftest）
- [x] Notion の全70件 + Notion 連携停止後の Slack 新着4件（10/5〜10/6）= **74件**を移行・暗号化
  - 担当者名の表記ゆれを統一: `笠原 雄希` / `小𠩤のあ` / `味岡 俊嘉`（＋過去の `matsuya`）
- [x] ルーティン作成: 「Slack指示タスク→タスクボード同期」（trigger id `trig_01NewYkRBQpN15sGAg5nmaxL`）
  - 平日 8:55 / 17:55 JST、毎回新規セッション。プロンプトは `docs/routine-prompt.md` と同じ内容
- [x] 絞り込み状態の URL 共有（`#who=担当者&st=未着手,進行中&due=over&q=語`）と「この表示のリンクをコピー」ボタン

### 設定（2026-10-08 夜にすべて完了）
- [x] GitHub **Settings → Pages**: Deploy from a branch / `main` / `(root)`
- [x] Claude Code クラウド環境の環境変数 `TASKBOARD_PASSWORD`
- [x] ルーティンに **Slack コネクタ**とリポジトリ `zp-task-board-yk` を追加
- [x] 手動実行で動作確認（10/8 19:59 JST）: Slack 読み取り・リポジトリ取得・復号まで成功。
  新着投稿が無く、未完了23件のスレッドにも完了/着手の返信が無かったため、変更0件で commit/push なし（想定どおり）
- [ ] 新規投稿を含む実データでの通し確認（Slack に新しい依頼が出たあと、push → サイト反映まで）
- [ ] チームに URL とパスワードを Slack で共有

### 未対応・既知の課題
- 取り込み済みの未完了タスク（約23件）の中には、実際は終わっているものが含まれる可能性がある（Notion 連携停止中のスレッド返信が未反映）。ルーティン初回実行時にスレッドを確認して反映される想定。
- 担当者の Slack ユーザーID と表示名の対応表はプロンプトに直書き。メンバーが増えたら `docs/routine-prompt.md` とルーティン本体の両方を更新する必要がある。
- ルーティンの実行ログは各回のセッションにしか残らない（失敗に気づきにくい）。

## 切り替え（カットオーバー）の手順 ― 新画面を本番にする

新画面は `next/` に作成済み（Google ログインの設定待ち）。本番（旧画面）は `index.html` のまま動いている。

1. ユーザーが `docs/SETUP-GOOGLE.md` の手順1〜2を実施し、クライアントID を Claude に伝える
2. `next/config.js` の `clientId` に設定 → ブラウザで `https://yukikasahara-droid.github.io/zp-task-board-yk/next/` を開き、実際にログイン・読み書きを確認
   - 確認項目: ログイン / 一覧表示（74件）/ 1タップ完了と「元に戻す」/ 追加 / 編集 / 前提タスク / スプレッドシートに反映されているか
3. ルーティンに **Google Sheets コネクタ**を追加し、プロンプトを `docs/routine-prompt-v2.md` に差し替えて手動実行 → スプレッドシートに新着が入るか確認
4. 問題なければ `next/` の中身をルートに移動（旧 `index.html` / `assets/` / `data/` / `scripts/tasks.mjs` は削除）、CLAUDE.md・README を更新
5. チームに新URLを案内（共有パスワードは不要になる）

ローカル確認: `python3 -m http.server 8767` → `http://localhost:8767/next/index.html?mock=1`（仮データ）。テスト: `npm test`。

## 3. 改善アイデア（未着手・優先度は未確認。着手前にユーザーに確認）
- 期限切れ・期限間近のタスクを毎朝 Slack にまとめて通知する
- 「最終同期時刻」と「同期の成否」をサイトに表示する（`updatedAt` は表示済み）
- 完了タスクのアーカイブ（一定期間経過で既定表示から外す）

## 4. 並行作業のルール（クラウド版 / デスクトップ版）

- 作業前に `git pull origin main`。作業はできるだけ小さく区切ってこまめに push する。
- **`data/tasks.enc.json` はルーティンも毎回書き換える。** データを手で直すときは
  `git pull` 直後に `decrypt → 編集 → encrypt → commit → push` を一気に行う。
  push が競合したら、自分の暗号化ファイルを捨てて pull し直し、編集をやり直す（暗号文はマージできない）。
- 画面やスクリプトの変更（`assets/` `scripts/` `index.html`）とデータの変更は**別コミット**にする。
- ブランチを切る場合は `feature/<内容>` とし、main へのマージ前に `node scripts/tasks.mjs selftest` とブラウザ表示を確認。
- 誰が何をしているか分かるよう、着手時に「作業ログ」に「作業中」と書いて push しておくと衝突を避けやすい。

## 5. 作業ログ

| 日付 | 作業者 | 内容 |
|---|---|---|
| 2026-10-07〜08 | クラウド版 Claude Code | 初版作成、Notion から74件移行、ルーティン作成、本メモと CLAUDE.md を追加 |
| 2026-10-08 夜 | クラウド版 Claude Code | URL での絞り込み共有を追加。初回ルーティン失敗の原因調査、ルーティンのプロンプトを堅牢化。設定完了後の手動実行で正常動作を確認 |
| 2026-10-08 夜 | クラウド版 Claude Code | ユーザーの要件変更（編集・カメラ・優先度・1タップ完了）を `REQUIREMENTS.md` に記録。技術選定の確認待ち |
| 2026-10-09 | クラウド版 Claude Code | データを Google スプレッドシートへ移行（74件）。新画面 `next/`（優先度・1タップ完了・編集）、ルーティン v2 案を作成。Google ログイン設定待ち |
