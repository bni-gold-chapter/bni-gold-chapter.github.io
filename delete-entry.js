// 刪掉某個節點底下的「一筆」資料（例如重複建立的四加一表）。
//
// 為什麼不用 restore-firebase：那支是整個節點 PUT 回去，等於把其他人的資料
// 也重寫一次。要刪一筆卻動到全部，萬一有人正在編輯就被蓋掉了。這支只對
// 目標 key 發 DELETE，其餘的鍵連碰都不碰。
//
// 用法：CONFIRM=<key> node delete-entry.js <節點> <key>
// 例：  CONFIRM=jgub6mn2a7 node delete-entry.js bio_v1 jgub6mn2a7
const fs = require('fs');
const path = require('path');
const FB = 'https://bni-tracker-b3ef8-default-rtdb.firebaseio.com';
const fb = require('./fb-auth');
const crypt = require('./backup-crypt');   // 快照加密存檔（公開 repo），需要 BACKUP_KEY
const DIR = path.join(__dirname, 'backups', '_pre-delete');

const [node, key] = process.argv.slice(2);
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const get = async p => {
  const r = await fetch(await fb.url(`${FB}/${p}.json`));
  const t = await r.text();
  if (!r.ok) throw new Error(`讀取 ${p} 失敗：HTTP ${r.status} ${t.slice(0, 200)}`);
  return JSON.parse(t);
};

(async () => {
  if (!node || !key) throw new Error('用法：CONFIRM=<key> node delete-entry.js <節點> <key>');
  if (process.env.CONFIRM !== key) {
    throw new Error(`確認失敗：請設定 CONFIRM=${key}（把 key 再打一次，避免誤刪）`);
  }

  crypt.keyFrom();   // 沒有鑰匙就存不了刪除前快照 → 先停下，什麼都不刪
  const before = await get(node);
  if (!before || typeof before !== 'object') throw new Error(`節點 ${node} 是空的或不是物件，沒有東西可刪。`);
  if (!(key in before)) throw new Error(`${node} 底下沒有 ${key}，不做任何事。`);

  // 鐵則 #2：動雲端之前先把整個節點存下來
  fs.mkdirSync(DIR, { recursive: true });
  const snap = crypt.writeBackup(path.join(DIR, `${node}.${stamp()}.json`), JSON.stringify(before, null, 2) + '\n');

  const target = before[key];
  const data = (target && target.data) || {};
  const filled = Object.values(data).filter(v => typeof v === 'string' && v.trim()).length;
  const others = Object.keys(before).filter(k => k !== key);
  console.log(`節點　　：${node}`);
  console.log(`要刪的　：${key}　姓名=${(target && target.name) || '(無)'}　已填欄位=${filled}`);
  console.log(`會保留　：${others.length} 筆 → ${others.join('、') || '(無)'}`);
  console.log(`刪除前的整個節點已存到 ${path.relative(__dirname, snap)}`);
  console.log('');

  const r = await fetch(await fb.url(`${FB}/${node}/${key}.json`), { method: 'DELETE' });
  if (!r.ok) throw new Error(`刪除失敗：HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);

  // 讀回來確認：目標不見了，而且其他鍵一個都沒少
  const after = await get(node);
  const left = after ? Object.keys(after) : [];
  if (left.includes(key)) throw new Error('刪除後讀回來目標還在 —— 請立刻人工檢查。');
  const lost = others.filter(k => !left.includes(k));
  if (lost.length) throw new Error(`誤刪了其他資料：${lost.join('、')} —— 立刻用 ${path.relative(__dirname, snap)} 還原！`);
  console.log(`✔ 已刪除 ${key}，其餘 ${left.length} 筆完好（${left.join('、')}）。`);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
