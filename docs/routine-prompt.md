# Claude ルーティン設定（Slack → タスクボード同期）

Claude Code のルーティン「Slack指示タスク→タスクボード同期」に登録しているプロンプトの控えです。
実際の登録内容では `<共有パスワード>` の部分に本物のパスワードが入っています（このファイルには書かない）。

- スケジュール: 平日 9:00 と 18:00（JST）
- 実行のたびに新しいセッションを起動
- 使うコネクタ: Slack, GitHub（Claude Code Remote 経由でリポジトリを取得・push）

---

````text
Slack #zp-status-kasahara（チャンネルID: C06FZL1TD99）に投稿された作業指示を、
GitHub リポジトリ yukikasahara-droid/zp-task-board-yk のタスクデータ（暗号化済み data/tasks.enc.json）に反映して main に push してください。
このタスクはユーザー（笠原 雄希）が依頼した定期処理です。追加の確認は不要です。main への直接 push もユーザーが許可しています。

■ 準備
1. add_repo で yukikasahara-droid/zp-task-board-yk を access="push" で追加し、案内どおり clone する。以降はそのディレクトリで作業する。
2. 環境変数を設定: export TASKBOARD_PASSWORD='<共有パスワード>'
   ※このパスワードをファイル・コミット・Slack・ログ出力に絶対に書かないこと。
3. `node scripts/tasks.mjs summary` を実行し、latestTs（登録済みの最新Slack TS）と open（未完了タスク一覧）を確認する。

■ 新規タスクの検出
4. slack_read_channel で channel_id=C06FZL1TD99、oldest=latestTs を指定して新しいメッセージを取得する（latestTs と同じTSの投稿は除外）。
5. 次は登録しない: 「has joined the channel」等のシステムメッセージ、botへの雑談、自動の出荷通知（DEVRshipmentBot/KSHRBot等の「発送するもの」「shipment発行」など、人への@メンションがない自動メッセージ）、スレッド内の返信。
   人（@メンション）に向けた作業指示のメッセージだけを登録する（自分自身へのメンションも登録対象）。
6. メッセージ1件につき1タスク。項目:
   - id: メッセージTS（文字列。例 "1791165154.620319"）
   - title: 内容を要約した短いタイトル
   - body: メッセージ本文（メンション記法 <@U...|名前> は除き、本文だけ。<url|text> は text (url) に）
   - assignees: メンションされた人のSlack表示名の配列。末尾の「_」や「_京都」等の勤務地・休暇メモは除く。
     メンバー表記の統一: 「笠原 雄希」「小𠩤のあ」「味岡 俊嘉」
   - status: "未着手"
   - assignedOn: 投稿日（JST, YYYY-MM-DD）
   - due: 本文の「◯/◯まで」「今週中」「金曜まで」「今日中」「火曜の13時まで」等から投稿日を基準に推定した期限（YYYY-MM-DD）。
     「今週中」はその週の金曜日。読み取れなければ null。

■ 完了・着手の反映
7. open の各タスク（id がSlack TS形式のもの）について slack_read_thread（channel_id=C06FZL1TD99, message_ts=id）でスレッド返信を確認する。
   - 返信に「完了」「終わりました」「done」等の完了報告があれば status を "完了" にする。
   - 未着手のタスクで「着手」「進行中」「対応中」「やります」等の返信があれば status を "進行中" にする。
   - 「完了したら教えて」のような依頼・質問は完了報告とみなさない。

■ 反映
8. 変更内容を /tmp/changes.json に書く（リポジトリ内には置かない）:
   {"add":[...6のタスク...], "update":[{"id":"...","status":"完了"}, ...]}
9. `node scripts/tasks.mjs apply /tmp/changes.json` を実行する。エラーが出たら内容を直して再実行。
10. 追加も更新も0件なら、commit せずに終了する。
11. 変更があれば data/tasks.enc.json だけを add して commit（メッセージ例: "sync: 新規2件・完了1件"）し、`git push origin HEAD:main` する。
    push が競合したら `git pull --rebase origin main` は使わず、clone し直して手順3からやり直す。
    data/tasks.json（平文）や changes.json は絶対に commit しない。

■ 報告
12. 新規登録件数・完了/進行中への更新件数を簡潔に報告する。重大なエラー以外はユーザーへの通知は不要。
````
