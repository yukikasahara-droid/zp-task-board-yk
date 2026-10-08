# Claude ルーティン v2（Slack → スプレッドシート）

新方式（Google スプレッドシートがデータベース）用のプロンプト案です。**切り替えるまでは、今動いている `routine-prompt.md`（暗号化JSON方式）が現役**です。
切り替え手順は `HANDOFF.md` の「切り替え（カットオーバー）」を参照。

必要なもの: ルーティンのコネクタに **Slack** と **Google Sheets**。パスワード（環境変数）とリポジトリは不要になります。

- スケジュール: 平日 8:55 と 17:55（JST）
- 実行のたびに新しいセッション

---

````text
Slack #zp-status-kasahara（チャンネルID: C06FZL1TD99）の作業指示を、Google スプレッドシート「ZPタスクボード（データ）」
（spreadsheetId: 1LAMK-h_1b8NNzrDAhmRn9KZKtE7lfRyHwtjpLwyeBsQ、タブ名 tasks）に反映してください。
このタスクはユーザー（笠原 雄希）が依頼した定期処理です。追加の確認は不要です。

■ 事前チェック
0. slack_read_channel / slack_read_thread と、Google Sheets の get_values / update_values / append_values が使えなければ、
   「◯◯コネクタ未接続」と報告して終了する。

■ 現状の読み取り
1. get_values で tasks!A1:N（A1:Z でも可）を読む。1行目は列名: id, title, body, assignees, status, assignedOn, due, completedOn, size, blockedBy, source, slackUrl, updatedAt, updatedBy。
   列の順番が違っていたら、列名で位置を判断する。
2. id が「数字.数字」形式（Slack のメッセージTS）の行のうち最大の値を latestTs とする。
   未完了（status が 未着手 / 進行中）の行を「未完了一覧」とする。

■ 新規タスクの検出
3. slack_read_channel で channel_id=C06FZL1TD99、oldest=latestTs を指定して新しいメッセージを取得（latestTs と同じ投稿は除く）。
4. 登録しない: 入退室などのシステムメッセージ、botへの雑談、自動の出荷通知（DEVRshipmentBot/KSHRBot 等で人へのメンションがないもの）、スレッド内の返信。
   人（@メンション）に向けた作業指示だけを登録する（自分へのメンションも登録する）。
5. メッセージ1件につき1タスク。項目:
   - id: メッセージTS
   - title: 内容を要約した短いタイトル
   - body: 本文（メンション記法 <@U...|名前> は除く。<url|text> は text (url) に）
   - assignees: メンションされた人の表示名。複数なら「、」区切り。末尾の「_」「_京都」等の勤務地・休暇メモは除く。
     表記は「笠原 雄希」「小𠩤のあ」「味岡 俊嘉」に統一（members タブにも一覧がある）
   - status: 未着手
   - assignedOn: 投稿日（JST, YYYY-MM-DD）
   - due: 本文の「◯/◯まで」「今週中」「金曜まで」「今日中」「火曜の13時まで」等から、投稿日を基準に推定した期限（YYYY-MM-DD）。「今週中」はその週の金曜。読み取れなければ空
   - size: 作業の重さ。S=1時間くらいまで / M=半日 / L=1日以上。本文から判断できなければ空
   - blockedBy: 「AのあとにB」「Aが終わってから」等、前提が明示されていて、前提が未完了一覧のタスクと特定できるときだけ、その id。曖昧なら空
   - source: slack
   - slackUrl: https://orylab.slack.com/archives/C06FZL1TD99/p<TSのドットを除いた数字>
   - updatedAt: 実行時刻（ISO形式）、updatedBy: ルーティン

■ 付箋の写真からの登録
6. 新しいメッセージに画像（付箋の写真）が添付されていたら、slack_read_file で画像を読み、付箋1枚につき1タスクにする。
   - 担当者は、そのメッセージでメンションされた人。メンションがなければ投稿者
   - id は「メッセージTS-1」「メッセージTS-2」…（付箋の順に連番）。source は camera
   - title / due / size は付箋の文字から。読み取れない文字は推測せず、body に「（読み取れず）」と書く
   - 画像そのもの（ファイル）は保存しない。読み取った文字だけを書く

■ 完了・着手の反映
7. 未完了一覧のうち、id が Slack TS 形式のもの（付箋由来の「TS-N」は TS の部分）について slack_read_thread でスレッド返信を確認する。
   - 完了報告（「完了」「終わりました」「done」等）があれば status を 完了、completedOn を今日（JST）にする
   - 未着手のものに「着手」「対応中」「やります」等の返信があれば status を 進行中にする
   - 「完了したら教えて」のような依頼・質問は完了報告とみなさない
   - すでにサイトで人が status を変えている行は、返信が人の変更より古いなら触らない（updatedBy がルーティン以外で、返信より新しいとき）

■ 書き込み（Google Sheets コネクタの書き込みは画面と同じ解釈をするので、次を守る）
8. 新規行は append_values（range: tasks!A1）で末尾に追加する。
   id・日付（assignedOn / due / completedOn / updatedAt）・blockedBy の値は、先頭に ' を付けた文字にする（例 "'1791165154.620319"、"'2026-10-08"）。付けないと数字や日付に変換されて壊れる。
9. 既存行の更新は、その行番号を指定して update_values で必要な列だけ書く（status, completedOn, updatedAt, updatedBy）。他の列は触らない。
10. 追加も更新も無ければ何も書かずに終了する。

■ 報告
11. 新規登録件数（うち付箋由来）、完了/進行中に更新した件数を簡潔に報告する。重大なエラー以外は通知不要。
````
