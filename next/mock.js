// 動作確認用の仮データ（Google にはつながない）。使うとき: next/ を開くとき URL に ?mock=1 を付ける
// 実際のタスクではない、架空のデータ。日付は今日を基準に作る。
const pad = (n) => String(n).padStart(2, '0');
function rel(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const MOCK_MEMBERS = [
  { name: '笠原 雄希', email: 'me@example.com' },
  { name: '小𠩤のあ', email: 'noa@example.com' },
  { name: '味岡 俊嘉', email: 'aji@example.com' },
];
export const MOCK_PROFILE = { name: '笠原 雄希', email: 'me@example.com' };

const t = (id, title, o = {}) => ({
  id, title, body: '', assignees: ['笠原 雄希'], status: '未着手', assignedOn: rel(-5), due: null,
  completedOn: null, size: '', blockedBy: [], source: 'slack', slackUrl: '', updatedAt: '', updatedBy: '', ...o,
});

export function createMockStore() {
  let tasks = [
    t('m1', '試作機の電源ユニット発注', { due: rel(1), size: 'M', body: '見積もりは取得済み。型番は先週のメモを参照', assignedOn: rel(-6) }),
    t('m2', '評価用の治具を3Dプリント', { due: rel(3), size: 'S', assignees: ['小𠩤のあ'], blockedBy: ['m3'], body: '図面が確定したら出力する' }),
    t('m3', '治具の図面を確定', { due: rel(10), size: 'M', status: '進行中' }),
    t('m4', 'ファームウェアの首向き更新', { due: rel(-2), size: 'L', body: 'ボタン押下時に前を向くように' }),
    t('m5', '展示会用バッテリー4台の準備', { due: rel(6), size: 'M', assignees: ['味岡 俊嘉'] }),
    t('m6', '備品管理シートの整理', { size: 'S', assignedOn: rel(-20), assignees: ['小𠩤のあ'] }),
    t('m7', '来期の部材単価を調べる', { due: rel(30), size: 'L', assignedOn: rel(-12) }),
    t('m8', '温度測定機のマニュアル作成', { assignees: ['味岡 俊嘉'], assignedOn: rel(-40) }),
    t('m9', '修理フローのレクチャー依頼', { assignees: ['matsuya'], due: rel(-900), assignedOn: rel(-905) }),
    t('m10', '古い見積もりの回収', { due: rel(-200), assignedOn: rel(-210), assignees: ['味岡 俊嘉'] }),
    t('m11', '梱包材の預かり証を依頼', { status: '完了', completedOn: rel(-1), assignedOn: rel(-8) }),
    t('m12', 'B卓の機体追加', { status: '完了', completedOn: rel(-3), assignedOn: rel(-9), assignees: ['小𠩤のあ'] }),
  ];
  const clone = (x) => ({ ...x, assignees: [...x.assignees], blockedBy: [...x.blockedBy] });
  const wait = () => new Promise((r) => setTimeout(r, 120));
  return {
    async load() { await wait(); return { tasks: tasks.map(clone), members: MOCK_MEMBERS }; },
    async patch(id, fields, who) { return (await this.patchMany([id], fields, who))[0]; },
    async patchMany(ids, fields, who) {
      await wait();
      return ids.map((id) => {
        const i = tasks.findIndex((x) => x.id === id);
        if (i < 0) throw new Error('このタスクはスプレッドシートから無くなっています。画面を更新してください');
        tasks[i] = { ...tasks[i], ...fields, updatedAt: new Date().toISOString(), updatedBy: who };
        return clone(tasks[i]);
      });
    },
    async add(task, who) {
      await wait();
      const full = { ...task, updatedAt: new Date().toISOString(), updatedBy: who };
      tasks = [...tasks, full];
      return clone(full);
    },
  };
}
