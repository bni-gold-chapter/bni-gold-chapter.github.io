// 把整個 Firebase 資料庫匯出成 repo 裡的檔案，git 歷史就是一份離線、有版本的備份。
//
// 為什麼需要這支：2026/09 資料庫被整個清空時，`backups_v1` 跟它要備份的資料
// 放在同一個資料庫裡，於是備份跟著一起消失 —— 等於完全沒有備份。備份必須
// 離開那個資料庫才算備份。
//
// 用法：node backup-firebase.js       （由 backup-firebase.yml 每小時自動跑，有變動才 commit）
//
// 一個節點寫成一個檔案，不是全部塞進一個大檔：沒變動的節點產生一模一樣的
// 位元組，git 就不會為它存新的 blob，repo 不會因為頻繁備份而膨脹。
const fs = require('fs');
const path = require('path');
const FB = 'https://bni-tracker-b3ef8-default-rtdb.firebaseio.com';
const fb = require('./fb-auth');
const crypt = require('./backup-crypt');   // 公開 repo：備份一律加密成 <節點>.json.enc（見 backup-crypt.js）
const DIR = path.join(__dirname, 'backups');

const get = async (p, q = '') => {
  const u = await fb.url(`${FB}/${p}.json${q ? '?' + q : ''}`);
  const r = await fetch(u);
  const txt = await r.text();
  if (!r.ok) throw new Error(`讀取 ${p || '根節點'} 失敗：HTTP ${r.status} ${txt.slice(0, 200)}`);
  try { return JSON.parse(txt); } catch (e) { throw new Error(`${p || '根節點'} 回應不是 JSON：${txt.slice(0, 200)}`); }
};

/* 物件的鍵排序後輸出，同樣的資料永遠產生同樣的位元組。
   （陣列保持原順序 —— 檢核表的列序、名單順序都是有意義的。） */
function stable(v) {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = stable(v[k]);
    return o;
  }
  return v;
}
const count = v => (v == null ? 0 : (Array.isArray(v) ? v.length : (typeof v === 'object' ? Object.keys(v).length : 1)));

(async () => {
  fs.mkdirSync(DIR, { recursive: true });
  crypt.keyFrom();   // 沒有 BACKUP_KEY 就在讀資料庫之前停下，絕不退回寫明文

  const root = await get('', 'shallow=true');
  if (root == null) {
    // 這正是 2026/09 那次的狀況。此時千萬不能把備份檔清空 —— 那就是連
    // 備份一起弄丟的那一步。什麼都不寫，大聲報錯讓 workflow 變紅。
    console.error('🚨 根節點是 null —— 整個資料庫是空的！');
    console.error('   為了不讓備份跟著被清掉，這次不寫入任何檔案。');
    console.error('   請立刻查明原因，並用 backups/ 裡既有的檔案還原。');
    process.exit(1);
  }

  const nodes = Object.keys(root).sort();
  console.log(`資料庫有 ${nodes.length} 個節點：${nodes.join('、')}\n`);

  const manifest = {};
  let skipped = 0;

  for (const node of nodes) {
    const file = path.join(DIR, `${node}.json`);
    const val = await get(node);
    const n = count(val);

    // 節點讀回來是空的，但既有備份不是空的 → 保留舊檔。
    // 資料真的被刪掉時，備份是唯一的救命繩，不可以被這次的空值蓋掉。
    const prev = n === 0 ? crypt.readBackup(file) : undefined;
    if (n === 0 && prev !== undefined) {
      const old = count(prev);
      if (old > 0) {
        console.log(`⚠ ${node.padEnd(12)} 雲端是空的，但備份有 ${old} 筆 → 保留舊備份，不覆蓋`);
        manifest[node] = { 筆數: old, 狀態: '雲端已空，保留舊備份' };
        skipped++;
        continue;
      }
    }

    const written = crypt.writeBackup(file, JSON.stringify(stable(val), null, 2) + '\n');
    const kb = (fs.statSync(written).size / 1024).toFixed(1);
    console.log(`✔ ${node.padEnd(12)} ${String(n).padStart(4)} 筆　${kb} KB`);
    manifest[node] = { 筆數: n };
  }

  // 節點從根節點整個消失的情況：上面的迴圈只走雲端有的節點，不會碰到它，
  // 舊備份雖然因此保住了，卻沒有人報警 —— 2026/09 那次 archive_v1 就是這樣
  // 整個不見的。所以這裡反過來檢查：備份裡有、雲端沒有的節點。
  const backedUp = new Set(fs.readdirSync(DIR)
    .filter(f => !f.startsWith('_') && /\.json(\.enc)?$/.test(f))
    .map(f => f.replace(/\.json(\.enc)?$/, '')));
  for (const name of backedUp) {
    if (nodes.includes(name)) continue;
    const old = count(crypt.readBackup(path.join(DIR, `${name}.json`)));
    if (old > 0) {
      console.log(`⚠ ${name.padEnd(12)} 雲端已經沒有這個節點，但備份有 ${old} 筆 → 保留舊備份`);
      manifest[name] = { 筆數: old, 狀態: '雲端已無此節點，保留舊備份' };
      skipped++;
    }
  }

  // 還原／刪除前留下的快照（_pre-restore、_pre-delete）若還是明文，順手鎖起來。
  // 內容原封不動，只是換成加密檔；之後要用時以 backup-crypt.js decrypt 解開。
  for (const sub of ['_pre-restore', '_pre-delete']) {
    const d = path.join(DIR, sub);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) {
      if (!f.endsWith('.json')) continue;
      crypt.writeBackup(path.join(d, f), fs.readFileSync(path.join(d, f), 'utf8'));
      console.log(`🔒 ${sub}/${f} → 已加密`);
    }
  }

  // manifest 不放時間戳 —— 內容沒變就要產生一模一樣的檔案，才不會每天都多一個 commit。
  // 「什麼時候備份的」由 git commit 自己記錄。
  fs.writeFileSync(path.join(DIR, '_manifest.json'), JSON.stringify(stable(manifest), null, 2) + '\n');

  console.log('');
  if (skipped) {
    console.error(`🚨 有 ${skipped} 個節點在雲端是空的，但備份裡有資料 —— 資料可能又被刪了，請立刻檢查。`);
    process.exit(1);
  }
  console.log('備份完成。');
})().catch(e => { console.error('❌', e.message); process.exit(1); });
