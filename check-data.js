// 唯讀：檢視雲端資料現況。不會寫入任何東西。
// 用途：懷疑資料不見、或想確認收緊權限後還讀得到時，跑這支。
// 用法：node check-data.js
const FB = 'https://bni-tracker-b3ef8-default-rtdb.firebaseio.com';
const fb = require('./fb-auth');

const get = async (path, q = '') => {
  const u = await fb.url(`${FB}/${path}.json${q ? '?' + q : ''}`);
  const r = await fetch(u);
  const txt = await r.text();
  if (!r.ok) return { err: `HTTP ${r.status} ${txt.slice(0, 120)}` };
  try { return { val: JSON.parse(txt) }; } catch (e) { return { err: '回應不是 JSON：' + txt.slice(0, 120) }; }
};
const n = v => (v == null ? 0 : (Array.isArray(v) ? v.length : Object.keys(v).length));

(async () => {
  console.log('=== 資料庫現況 ===\n');

  const root = await get('', 'shallow=true');
  if (root.err) { console.log('❌ 讀不到根節點：', root.err); process.exit(1); }
  if (root.val == null) {
    console.log('🚨 根節點是 null —— 整個資料庫是空的！');
    process.exit(1);
  }
  const keys = Object.keys(root.val);
  console.log(`根節點有 ${keys.length} 個子節點：${keys.join('、')}\n`);

  const t = await get('tracker_v7/newMembers');
  console.log(`tracker_v7 / 進行中村民：${n(t.val)} 位` + (t.err ? '  ⚠ ' + t.err : ''));
  if (Array.isArray(t.val)) t.val.forEach(m => console.log(`    · ${m && m.name}`));

  const g = await get('tracker_v7/new', 'shallow=true');
  console.log(`tracker_v7 / 檢核列數：${n(g.val)}` + (g.err ? '  ⚠ ' + g.err : ''));

  for (const [node, label] of [['archive_v1', '已出村封存'], ['bio_v1', '四加一表'],
                               ['backups_v1', '自動備份'], ['logs_v1', '操作紀錄']]) {
    const r = await get(node, 'shallow=true');
    console.log(`${node.padEnd(12)} ${label}：${n(r.val)} 筆` + (r.err ? '  ⚠ ' + r.err : ''));
  }

  const rd = await get('refdata/meta');
  console.log(`refdata      紅綠燈數據：最後更新 ${(rd.val && rd.val.updatedAt) || '（無）'}`
              + (rd.err ? '  ⚠ ' + rd.err : ''));

  const bk = await get('backups_v1', 'shallow=true');
  if (bk.val) {
    const ids = Object.keys(bk.val);
    console.log(`\n最近的備份 key（要還原時用得到）：${ids.slice(-3).join('、')}`);
  }
  console.log('\n（這支腳本只讀不寫）');
})().catch(e => { console.error('失敗：', e.message); process.exit(1); });
