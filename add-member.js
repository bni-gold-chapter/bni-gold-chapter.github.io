// 新增村民到雲端名單（比照網站協調員模式的 addMember 行為）
// 用法：先把資料寫進 new-member.json（name/ind/mentor/join/note），再執行 node add-member.js
const FB = 'https://bni-tracker-b3ef8-default-rtdb.firebaseio.com';
const NODE = 'tracker_v7';

const m = JSON.parse(require('fs').readFileSync(process.argv[2] || 'new-member.json', 'utf8'));
if (!m.name) { console.error('缺少 name'); process.exit(1); }

const stamp = new Date().toLocaleString('zh-TW', { hour12: false, timeZone: 'Asia/Taipei' });

(async () => {
  const d = await (await fetch(`${FB}/${NODE}.json`)).json();
  if (!d || !Array.isArray(d.new)) { console.error('讀不到雲端資料'); process.exit(1); }

  const members = d.newMembers || [];
  if (members.some(x => x.name === m.name)) { console.error(`名單中已有「${m.name}」`); process.exit(1); }

  console.log(`異動前：${members.length} 位（${members.map(x => x.name).join('、')}）`);
  console.log(`grid ${d.new.length} 列 x ${d.new[0].length} 欄`);

  // 1) 全量備份（與網站 backupCloud 相同節點）
  await fetch(`${FB}/backups_v1.json`, {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ t: Date.now(), by: '導師協調員', reason: '新增村民：' + m.name, data: d })
  });
  console.log('✔ 已備份到 backups_v1');

  // 2) 加人：名單 + 每列補一欄 + 備註
  members.push({
    name: m.name, npc: '', ind: m.ind || '', mentor: m.mentor || '',
    light: null, join: m.join || '', miss: '', note: m.note || ''
  });
  d.newMembers = members;
  d.new.forEach(r => r.push([0, '']));
  d.newNotes = [...(d.newNotes || []), m.note || ''];

  const put = await fetch(`${FB}/${NODE}.json`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(d)
  });
  console.log(`✔ 寫入 ${NODE}：HTTP ${put.status}`);

  // 3) 操作紀錄
  await fetch(`${FB}/logs_v1.json`, {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      t: Date.now(), who: '導師協調員', ver: '系統', member: '', item: '',
      act: `➕ 新增村民：${m.name}${m.mentor ? `（導師 ${m.mentor}）` : ''}`
    })
  });
  console.log('✔ 已寫入操作紀錄');

  // 4) 驗證
  const v = await (await fetch(`${FB}/${NODE}.json`)).json();
  console.log(`\n異動後：${v.newMembers.length} 位（${v.newMembers.map(x => x.name).join('、')}）`);
  console.log(`grid ${v.new.length} 列 x ${v.new[0].length} 欄　newNotes ${v.newNotes.length} 筆`);
  const cols = v.new[0].length;
  for (let c = 0; c < cols; c++) {
    console.log(`  ${v.newMembers[c].name}：完成 ${v.new.filter(r => r[c] && r[c][0] === 1).length}/17`);
  }
})().catch(e => { console.error('失敗：', e.message); process.exit(1); });
