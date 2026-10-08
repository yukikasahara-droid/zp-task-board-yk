# Google 側の設定手順（初回のみ）

新しい ZPタスクボードは、データを Google スプレッドシート（Drive）に置き、会社の Google アカウントでログインして読み書きします。
そのために、次の3つを行います。所要時間は合計15分ほどです。

## データの置き場所

- スプレッドシート「ZPタスクボード（データ）」
  - ID: `1LAMK-h_1b8NNzrDAhmRn9KZKtE7lfRyHwtjpLwyeBsQ`
  - https://docs.google.com/spreadsheets/d/1LAMK-h_1b8NNzrDAhmRn9KZKtE7lfRyHwtjpLwyeBsQ/edit
  - タブ `tasks`（本体）、`列の説明`
- スプレッドシートの ID はパスワードではありません。ファイルを開けるのは、共有された人だけです。

## 手順1: スプレッドシートを会社の人に共有する

1. 上のURLを開く
2. 右上の「共有」→「一般的なアクセス」を「制限付き」から **orylab.com の全員**に変える
3. 権限を **編集者** にして「完了」

（特定の人だけにしたい場合は、メンバーのメールアドレスを個別に追加して編集者にする）

## 手順2: Google Cloud で「ログイン用のID」を作る

サイトに Google ログインを付けるために必要です。費用はかかりません。

1. https://console.cloud.google.com/ を開く（会社のアカウントでログイン）
2. 画面上部のプロジェクト選択 →「新しいプロジェクト」→ 名前 `zp-task-board` →「作成」
3. 左メニュー「APIとサービス」→「ライブラリ」→ **Google Sheets API** を検索 →「有効にする」
4. 左メニュー「APIとサービス」→「OAuth 同意画面」（「Google Auth Platform」と表示されることもある）→「開始」
   - アプリ名: `ZPタスクボード`
   - ユーザーサポートメール: 自分のメール
   - 対象（Audience）: **内部（Internal）** を選ぶ ← 重要。会社のアカウントだけが使える設定で、Google の審査が不要になる
   - 連絡先メール: 自分のメール →「作成」
5. 「データアクセス」（スコープ）→「スコープを追加または削除」→ 次を追加して保存
   - `https://www.googleapis.com/auth/spreadsheets`
6. 「クライアント」→「クライアントを作成」
   - アプリケーションの種類: **ウェブ アプリケーション**
   - 名前: `ZPタスクボード`
   - 承認済みの JavaScript 生成元に次を追加（末尾にスラッシュや `/zp-task-board-yk` は付けない）
     - `https://yukikasahara-droid.github.io`
     - （手元で試す人だけ）`http://localhost:8765`
   - 「作成」
7. 表示された **クライアントID**（`xxxxxxxx.apps.googleusercontent.com` の形）をコピーして、Claude に伝える
   - クライアントシークレットは使いません。クライアントID は秘密情報ではないので、チャットに貼って大丈夫です。

### うまくいかないとき

- 「内部」が選べない／プロジェクトを作れない: 会社の Google Workspace 管理者が制限している可能性があります。
  その場合は Claude に伝えてください（別の方式を用意します）。

## 手順3: Slack 取り込みのルーティンに Google スプレッドシートを接続する

1. https://claude.ai/code の「ルーティン」→「Slack指示タスク→タスクボード同期」を開く
2. コネクタに **Google Sheets** を追加（Slack は追加済み）
3. 保存

※ ルーティンのプロンプトは Claude が新方式（スプレッドシートに書く）に更新します。手順3は、その更新後に実行しても構いません。
