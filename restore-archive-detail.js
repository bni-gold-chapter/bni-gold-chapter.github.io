// 補回封存紀錄的細節（2026/09 資料遺失後只剩骨架）
// 來源：本機 8/9 的 archive + tracker 備份（真實資料），不是憑記憶重打
// 用法：node restore-archive-detail.js          → 只預覽，不寫入
//       node restore-archive-detail.js --write  → 實際寫入（會先備份）
const fs = require('fs');
const FB = 'https://bni-tracker-b3ef8-default-rtdb.firebaseio.com';
const fb = require('./fb-auth');
const WRITE = process.argv.includes('--write');

const pick = p => fs.readdirSync('.').filter(x => x.startsWith(p)).sort().pop();
const OLD_ARC = JSON.parse(fs.readFileSync(pick('backup-archive_v1'), 'utf8'));
const OLD_TRK = JSON.parse(fs.readFileSync(pick('backup-tracker_v7'), 'utf8'));

// 8/9 備份沒有 join 欄位的兩位，補上原始名單的入會日
const JOIN_FIX = { '邱士傑': '114.07.08', '洪倧勝': '114.12.11' };

// 吳至軒 8/9 之後才出村，從當日在村快照重建；燈號／尚缺取 9/7 最後一次觀測
function buildWu() {
  const i = OLD_TRK.newMembers.findIndex(m => m.name === '吳至軒');
  if (i < 0) return null;
  const m = OLD_TRK.newMembers[i];
  const items = OLD_TRK.new.map(r => {
    const c = (r[i] || [0, '']);
    return [c[0], c[1] || ''];
  });
  items[12] = [1, items[12][1] || '已報名'];   // 第13項 MSP：8/9 仍進行中，出村時已完成
  return {
    name: '吳至軒', ver: 'new', ind: m.ind || '', npc: m.npc || '', mentor: m.mentor || '',
    light: 75, join: m.join || '', miss: '培訓 1分、成交 69萬',
    note: OLD_TRK.newNotes[i] || '', done: items.filter(c => c[0] === 1).length,
    total: items.length, archivedAt: ''   // 確切封存時間已無從查證，留空不杜撰
  , items };
}

(async () => {
  const cur = await (await fetch(await fb.url(`${FB}/archive_v1.json`))).json() || [];
  const wu = buildWu();
  const out = cur.map(c => {
    if (c.ind) return c;                                   // 已有細節（許柏祥）不動
    const src = OLD_ARC.find(x => x.name === c.name);
    if (src) {
      const r = Object.assign({}, src);
      if (!r.join && JOIN_FIX[r.name]) r.join = JOIN_FIX[r.name];
      return r;
    }
    if (c.name === '吳至軒' && wu) return wu;
    return c;
  });

  console.log(WRITE ? '=== 寫入模式 ===\n' : '=== 預覽（不寫入）===\n');
  out.forEach((r, n) => {
    const b = cur[n], changed = JSON.stringify(b) !== JSON.stringify(r);
    const notes = (r.items || []).filter(c => c[1]).length;
    console.log(`${changed ? '更新' : '不變'}　${r.name}（${r.ver} ${r.done}/${r.total}）`);
    if (changed) console.log(`      ${r.ind}｜導師 ${r.mentor}｜燈號 ${r.light}｜入會 ${r.join || '—'}｜封存 ${r.archivedAt || '（不詳）'}｜逐項備註 ${notes} 項`);
  });

  if (!WRITE) { console.log('\n加上 --write 才會實際寫入。'); return; }

  fs.writeFileSync('backups/_pre-restore/archive_v1.detail-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json', JSON.stringify(cur, null, 1));
  await fetch(await fb.url(`${FB}/backups_v1.json`), {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ t: Date.now(), by: '導師協調員', reason: '補回封存細節前的備份', archiveBefore: cur })
  });
  const put = await fetch(await fb.url(`${FB}/archive_v1.json`), {
    method: 'PUT', headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(out)
  });
  console.log(`\n✔ 已備份　✔ archive_v1 PUT ${put.status}`);
  await fetch(await fb.url(`${FB}/logs_v1.json`), {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ t: Date.now(), who: '導師協調員', ver: '系統', member: '', item: '',
      act: '🔧 從 8/9 本機備份補回 7 位出村村民的封存細節' })
  });
})().catch(e => { console.error('失敗：', e.message); process.exit(1); });
