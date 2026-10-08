// 用 backups/ 裡的檔案把某個節點還原回 Firebase。
//
// 一份還原不回去的備份不算備份，所以有這支。但它會覆蓋雲端資料，
// 所以刻意設計成「不可能手滑跑到」：必須把節點名字再打一次當確認。
//
// 用法：CONFIRM=<節點名> node restore-firebase.js <節點名>
// 例：  CONFIRM=archive_v1 node restore-firebase.js archive_v1
//
// 還原前會先把雲端現在的內容存成 backups/_pre-restore/<節點>.<時間>.json，
// 萬一還原的方向是錯的，還有路可以回頭（鐵則 #2：改雲端前先備份）。
const fs = require('fs');
const path = require('path');
const FB = 'https://bni-tracker-b3ef8-default-rtdb.firebaseio.com';
const fb = require('./fb-auth');
const crypt = require('./backup-crypt');   // 備份是加密檔（<節點>.json.enc），需要 BACKUP_KEY
const DIR = path.join(__dirname, 'backups');

const node = process.argv[2];
const count = v => (v == null ? 0 : (Array.isArray(v) ? v.length : (typeof v === 'object' ? Object.keys(v).length : 1)));
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

(async () => {
  if (!node) throw new Error('請指定節點名稱，例：CONFIRM=archive_v1 node restore-firebase.js archive_v1');
  if (process.env.CONFIRM !== node) {
    throw new Error(`確認失敗：請設定 CONFIRM=${node}（把節點名字再打一次，避免誤觸）`);
  }

  const file = path.join(DIR, `${node}.json`);
  const data = crypt.readBackup(file);
  if (data === undefined) throw new Error(`找不到備份檔 ${path.relative(__dirname, file)}(.enc)`);
  if (data == null || count(data) === 0) {
    throw new Error(`備份檔 ${node}.json 是空的 —— 用它還原只會把雲端也清空，拒絕執行。`);
  }

  // 先留住雲端現況
  const cur = await fetch(await fb.url(`${FB}/${node}.json`)).then(r => r.text());
  let curVal = null;
  try { curVal = JSON.parse(cur); } catch (e) { /* 讀不動就當成空的，照樣往下走 */ }
  fs.mkdirSync(path.join(DIR, '_pre-restore'), { recursive: true });
  const pre = crypt.writeBackup(path.join(DIR, '_pre-restore', `${node}.${stamp()}.json`), JSON.stringify(curVal, null, 2) + '\n');

  console.log(`節點　　：${node}`);
  console.log(`雲端現況：${count(curVal)} 筆　→ 已存到 ${path.relative(__dirname, pre)}`);
  console.log(`要寫入　：${count(data)} 筆（來自 ${node}.json）`);
  console.log('');

  const r = await fetch(await fb.url(`${FB}/${node}.json`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!r.ok) throw new Error(`寫入失敗：HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);

  // 寫完讀回來確認，不要只相信 HTTP 200
  const back = JSON.parse(await fetch(await fb.url(`${FB}/${node}.json`)).then(x => x.text()));
  if (count(back) !== count(data)) {
    throw new Error(`寫入後讀回來筆數不符（預期 ${count(data)}，實際 ${count(back)}）—— 請立刻人工檢查。`);
  }
  console.log(`✔ 還原完成，讀回確認 ${count(back)} 筆。`);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
