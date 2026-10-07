#!/usr/bin/env node
// タスクデータ（data/tasks.enc.json）を操作するコマンド。
// パスワードは環境変数 TASKBOARD_PASSWORD で渡す（ファイルやコードには書かない）。
//
//   node scripts/tasks.mjs summary              最新のSlack TSと、未完了タスクの一覧を表示
//   node scripts/tasks.mjs apply changes.json   追加・更新をまとめて反映して再暗号化
//   node scripts/tasks.mjs decrypt              data/tasks.json（平文・git管理外）に書き出す
//   node scripts/tasks.mjs encrypt              data/tasks.json を暗号化して保存
//   node scripts/tasks.mjs selftest             暗号化の往復と入力チェックの動作確認
//
// changes.json の形:
//   {
//     "add":    [ { "id": "<Slack TS>", "title": "...", "body": "...", "assignees": ["笠原 雄希"],
//                   "status": "未着手", "assignedOn": "2026-10-07", "due": null } ],
//     "update": [ { "id": "<Slack TS>", "status": "完了" } ]
//   }

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encryptJson, decryptJson } from '../assets/crypto.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENC_PATH = path.join(ROOT, 'data', 'tasks.enc.json');
const PLAIN_PATH = path.join(ROOT, 'data', 'tasks.json');

const SLACK_CHANNEL_URL = 'https://orylab.slack.com/archives/C06FZL1TD99';
const STATUSES = ['未着手', '進行中', '完了'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function password() {
  const pw = process.env.TASKBOARD_PASSWORD;
  if (!pw) throw new Error('環境変数 TASKBOARD_PASSWORD にパスワードを設定してください');
  return pw;
}

/** 日本時間の今日（YYYY-MM-DD） */
function todayJst() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Slack のメッセージTS（例 1791165154.620319）から元メッセージへのリンクを作る */
export function slackUrlFromTs(ts) {
  return /^\d+\.\d+$/.test(ts) ? `${SLACK_CHANNEL_URL}/p${ts.replace('.', '')}` : null;
}

export function validateTask(t) {
  const errors = [];
  if (!t.id || typeof t.id !== 'string') errors.push('id がありません');
  if (!t.title || typeof t.title !== 'string') errors.push('title がありません');
  if (!Array.isArray(t.assignees) || t.assignees.length === 0) errors.push('assignees は1人以上の配列にしてください');
  if (!STATUSES.includes(t.status)) errors.push(`status は ${STATUSES.join(' / ')} のどれかにしてください`);
  for (const k of ['assignedOn', 'due', 'completedOn']) {
    if (t[k] != null && !DATE_RE.test(t[k])) errors.push(`${k} は YYYY-MM-DD 形式にしてください`);
  }
  if (errors.length) throw new Error(`タスク ${t.id ?? '(id不明)'}: ${errors.join('、')}`);
}

function normalizeTask(t) {
  const task = {
    id: String(t.id),
    title: t.title,
    body: t.body ?? '',
    assignees: t.assignees,
    status: t.status ?? '未着手',
    assignedOn: t.assignedOn ?? null,
    due: t.due ?? null,
    completedOn: t.completedOn ?? null,
    slackUrl: t.slackUrl ?? slackUrlFromTs(String(t.id)),
  };
  validateTask(task);
  return task;
}

function sortTasks(tasks) {
  // 指示日の新しい順（同じ日なら Slack TS の新しい順）
  return tasks.sort((a, b) => (b.assignedOn ?? '').localeCompare(a.assignedOn ?? '') || b.id.localeCompare(a.id));
}

/** 追加・更新を反映した新しいデータを返す（元のデータは変更しない） */
export function applyChanges(data, changes) {
  const tasks = data.tasks.map((t) => ({ ...t }));
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const report = { added: [], skipped: [], updated: [] };

  for (const raw of changes.add ?? []) {
    if (byId.has(String(raw.id))) {
      report.skipped.push(String(raw.id)); // 登録済み（重複防止）
      continue;
    }
    const task = normalizeTask(raw);
    tasks.push(task);
    byId.set(task.id, task);
    report.added.push(task.id);
  }

  for (const u of changes.update ?? []) {
    const task = byId.get(String(u.id));
    if (!task) throw new Error(`更新対象のタスク ${u.id} が見つかりません`);
    const before = task.status;
    for (const k of ['title', 'body', 'assignees', 'status', 'due', 'completedOn']) {
      if (k in u) task[k] = u[k];
    }
    if (task.status === '完了' && before !== '完了' && !task.completedOn) task.completedOn = todayJst();
    if (task.status !== '完了') task.completedOn = null;
    validateTask(task);
    report.updated.push(task.id);
  }

  return { data: { updatedAt: new Date().toISOString(), tasks: sortTasks(tasks) }, report };
}

async function load() {
  return decryptJson(JSON.parse(fs.readFileSync(ENC_PATH, 'utf8')), password());
}

async function save(data) {
  const payload = await encryptJson(data, password());
  fs.writeFileSync(ENC_PATH, JSON.stringify(payload, null, 2) + '\n');
}

function summary(data) {
  const slackIds = data.tasks.map((t) => t.id).filter((id) => /^\d+\.\d+$/.test(id));
  const latestTs = slackIds.sort((a, b) => Number(b) - Number(a))[0] ?? null;
  return {
    updatedAt: data.updatedAt,
    total: data.tasks.length,
    latestTs,
    open: data.tasks
      .filter((t) => t.status !== '完了')
      .map(({ id, title, status, assignees, due }) => ({ id, title, status, assignees, due })),
  };
}

async function selftest() {
  const pw = 'selftest-password';
  const sample = { updatedAt: 'x', tasks: [] };
  const back = await decryptJson(await encryptJson(sample, pw), pw);
  if (JSON.stringify(back) !== JSON.stringify(sample)) throw new Error('暗号化の往復に失敗');
  let rejected = false;
  try {
    await decryptJson(await encryptJson(sample, pw), 'wrong');
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error('間違ったパスワードで復号できてしまった');

  const add = { id: '1791165154.620319', title: 't', assignees: ['a'], assignedOn: '2026-10-05' };
  const { data, report } = applyChanges(sample, { add: [add, add] });
  if (report.added.length !== 1 || report.skipped.length !== 1) throw new Error('重複防止が効いていない');
  if (data.tasks[0].slackUrl !== `${SLACK_CHANNEL_URL}/p1791165154620319`) throw new Error('Slackリンクの生成が不正');
  const done = applyChanges(data, { update: [{ id: add.id, status: '完了' }] }).data.tasks[0];
  if (done.status !== '完了' || !done.completedOn) throw new Error('完了更新が不正');
  let invalid = false;
  try {
    applyChanges(data, { update: [{ id: add.id, status: '終わり' }] });
  } catch {
    invalid = true;
  }
  if (!invalid) throw new Error('不正なステータスを受け付けてしまった');
  console.log('selftest OK');
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  switch (cmd) {
    case 'summary':
      console.log(JSON.stringify(summary(await load()), null, 2));
      break;
    case 'apply': {
      if (!arg) throw new Error('使い方: node scripts/tasks.mjs apply changes.json');
      const changes = JSON.parse(fs.readFileSync(arg, 'utf8'));
      const { data, report } = applyChanges(await load(), changes);
      await save(data);
      console.log(JSON.stringify(report, null, 2));
      break;
    }
    case 'decrypt':
      fs.writeFileSync(PLAIN_PATH, JSON.stringify(await load(), null, 2) + '\n');
      console.log(`書き出しました: ${path.relative(ROOT, PLAIN_PATH)}（git には入りません）`);
      break;
    case 'encrypt': {
      const data = JSON.parse(fs.readFileSync(PLAIN_PATH, 'utf8'));
      data.tasks = sortTasks(data.tasks.map(normalizeTask));
      data.updatedAt = new Date().toISOString();
      await save(data);
      console.log(`暗号化しました: ${data.tasks.length} 件`);
      break;
    }
    case 'selftest':
      await selftest();
      break;
    default:
      console.log('使い方: node scripts/tasks.mjs <summary|apply|decrypt|encrypt|selftest>');
      process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(`エラー: ${e.message}`);
  process.exitCode = 1;
});
