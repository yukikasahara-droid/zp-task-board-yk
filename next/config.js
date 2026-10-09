// 設定。ここに書く値はどれも秘密ではない（クライアントIDもスプレッドシートIDも公開されて問題ない）。
// データを読み書きできるのは、スプレッドシートを共有された Google アカウントだけ。
export const CONFIG = {
  sheetId: '1LAMK-h_1b8NNzrDAhmRn9KZKtE7lfRyHwtjpLwyeBsQ',
  tasksTab: 'tasks',
  managerGid: 6, // 「マネージャー集計」タブ（スプレッドシートのURL末尾の gid）
  membersTab: 'members',
  // docs/SETUP-GOOGLE.md の手順2で作った「クライアントID」を入れる（xxxx.apps.googleusercontent.com）
  clientId: '',
};
