// 修改雲端名單中某位村民的欄位（會先自動備份）
// 用法：node edit-member.js <姓名> <欄位> <新值>
//   例：node edit-member.js 賴冠仁 join 115.08.20
const FB = 'https://bni-tracker-b3ef8-default-rtdb.firebaseio.com';
const NODE = 'tracker_v7';
const [, , name, field, ...rest] = process.argv;
const value = rest.join(' ');
const OK = ['ind', 'mentor', 'join', 'npc', 'note', 'name'];

if (!name || !field || !OK.includes(field)) {
  console.error(`用法：node edit-member.js <姓名> <${OK.join('|')}> <新值>`);
  process.exit(1);
}

(async () => {
  const d = await (await fetch(`${FB}/${NODE}.json`)).json();
  const list = d.newMembers || [];
  const i = list.findIndex(x => x.name === name);
  if (i < 0) { console.error(`名單中找不到「${name}」（目前：${list.map(x => x.name).join('、')}）`); process.exit(1); }

  const before = list[i][field];
  if (before === value) { console.log(`「${name}」的 ${field} 已經是「${value}」，不需修改。`); return; }

  await fetch(`${FB}/backups_v1.json`, {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ t: Date.now(), by: '導師協調員', reason: `修改 ${name} 的 ${field}`, data: d })
  });
  console.log('✔ 已備份到 backups_v1');

  list[i][field] = value;
  // note 欄位同時同步到可編輯的出村備註（畫面上顯示的是這個）
  if (field === 'note') { d.newNotes = d.newNotes || []; d.newNotes[i] = value; }
  d.newMembers = list;

  const put = await fetch(`${FB}/${NODE}.json`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(d)
  });
  console.log(`✔ 寫入 ${NODE}：HTTP ${put.status}`);

  await fetch(`${FB}/logs_v1.json`, {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      t: Date.now(), who: '導師協調員', ver: '系統', member: name, item: field,
      act: `✏️ 修改資料：${field} ${before || '（空白）'} → ${value}`
    })
  });
  console.log('✔ 已寫入操作紀錄');

  const v = await (await fetch(`${FB}/${NODE}.json`)).json();
  const m = v.newMembers.find(x => x.name === name);
  console.log(`\n${name}：${JSON.stringify(m, null, 1)}`);
})().catch(e => { console.error('失敗：', e.message); process.exit(1); });
