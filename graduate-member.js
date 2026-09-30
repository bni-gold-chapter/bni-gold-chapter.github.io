// 封存出村：把某位村民從在村名單移入 archive_v1（會先自動備份）
// 用法：node graduate-member.js <姓名>
// 若 archive 已有同名（例如資料遺失後重建的空殼），會用在村的真實資料「取代」該筆，不產生重複。
const FB = 'https://bni-tracker-b3ef8-default-rtdb.firebaseio.com';
const fb = require('./fb-auth');
const NODE = 'tracker_v7';
const name = process.argv[2];
if (!name) { console.error('用法：node graduate-member.js <姓名>'); process.exit(1); }

const stamp = new Date().toLocaleString('zh-TW', { hour12: false, timeZone: 'Asia/Taipei' });

(async () => {
  const d = await (await fetch(await fb.url(`${FB}/${NODE}.json`))).json();
  const arc = (await (await fetch(await fb.url(`${FB}/archive_v1.json`))).json()) || [];
  const list = d.newMembers || [];
  const i = list.findIndex(x => x.name === name);
  if (i < 0) { console.error(`在村名單找不到「${name}」（目前：${list.map(x => x.name).join('、')}）`); process.exit(1); }

  const m = list[i];
  const items = d.new.map(r => (r[i] || [0, '']));
  const done = items.filter(c => c[0] === 1).length;
  const total = d.new.length;
  console.log(`${name}：${done}/${total}，有備註的項目 ${items.filter(c => c[1]).length} 項`);
  if (done < total) {
    console.error(`⚠️ 尚未 100% 完成（${done}/${total}），中止。出村需全部完成。`);
    process.exit(1);
  }

  // 1) 備份
  await fetch(await fb.url(`${FB}/backups_v1.json`), {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ t: Date.now(), by: '導師協調員', reason: `封存出村：${name}`, data: d, archiveBefore: arc })
  });
  console.log('✔ 已備份 tracker + archive 到 backups_v1');

  // 2) 產生封存快照（用在村的真實資料）
  const snap = {
    name: m.name, ind: m.ind || '', npc: m.npc || '', mentor: m.mentor || '',
    light: (m.light == null ? null : m.light), join: m.join || '', miss: m.miss || '',
    note: (d.newNotes || [])[i] || '', ver: 'new', done, total, items, archivedAt: stamp
  };
  const at = arc.findIndex(x => x.name === name);
  if (at >= 0) { arc[at] = snap; console.log(`✔ 取代 archive 既有的「${name}」（原為重建空殼）`); }
  else { arc.push(snap); console.log('✔ 新增到 archive'); }

  // 3) 從在村名單移除該欄
  d.new = d.new.map(r => r.filter((_, c) => c !== i));
  d.newNotes = (d.newNotes || []).filter((_, c) => c !== i);
  d.newMembers = list.filter((_, c) => c !== i);

  const a1 = await fetch(await fb.url(`${FB}/archive_v1.json`), { method: 'PUT', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(arc) });
  const a2 = await fetch(await fb.url(`${FB}/${NODE}.json`), { method: 'PUT', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(d) });
  console.log(`✔ archive_v1 PUT ${a1.status} ／ ${NODE} PUT ${a2.status}`);

  await fetch(await fb.url(`${FB}/logs_v1.json`), {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ t: Date.now(), who: '導師協調員', ver: '系統', member: name, item: '',
      act: `🎓 封存出村：${name}（${done}/${total}）` })
  });
  console.log('✔ 已寫入操作紀錄');

  const v = await (await fetch(await fb.url(`${FB}/${NODE}.json`))).json();
  const va = await (await fetch(await fb.url(`${FB}/archive_v1.json`))).json();
  console.log(`\n在村 ${v.newMembers.length} 位：${v.newMembers.map(x => x.name).join('、')}`);
  console.log(`grid ${v.new.length} 列 x ${v.new[0].length} 欄　notes ${v.newNotes.length} 筆`);
  console.log(`已封存 ${va.length} 位：${va.map(x => x.name).join('、')}`);
})().catch(e => { console.error('失敗：', e.message); process.exit(1); });
