// 從匯出備份還原在村村民的勾選與備註（依姓名比對，不動名單）
// 用法：node restore-progress.js <備份檔>            → 預覽
//       node restore-progress.js <備份檔> --write    → 實際寫入（先備份）
const fs = require('fs');
const FB = 'https://bni-tracker-b3ef8-default-rtdb.firebaseio.com';
const fb = require('./fb-auth');
const SRC = process.argv[2];
const WRITE = process.argv.includes('--write');
if (!SRC) { console.error('用法：node restore-progress.js <備份檔> [--write]'); process.exit(1); }
const bk = JSON.parse(fs.readFileSync(SRC, 'utf8'));

(async () => {
  const cur = await (await fetch(await fb.url(`${FB}/tracker_v7.json`))).json();
  let cells = 0, people = [];

  cur.newMembers.forEach((m, ci) => {
    const bi = bk.newMembers.findIndex(x => x.name === m.name);
    if (bi < 0) return;                       // 備份沒有這個人 → 完全不動
    let changed = 0;
    for (let n = 0; n < cur.new.length; n++) {
      const c = cur.new[n][ci] || [0, ''], b = bk.new[n][bi] || [0, ''];
      if (c[0] !== b[0] || c[1] !== b[1]) { cur.new[n][ci] = [b[0], b[1]]; changed++; }
    }
    const bn = (bk.newNotes || [])[bi] || '';
    if (((cur.newNotes || [])[ci] || '') !== bn) { cur.newNotes[ci] = bn; changed++; }
    if (changed) { cells += changed; people.push(`${m.name}(${changed} 處)`); }
  });

  console.log(WRITE ? '=== 寫入模式 ===' : '=== 預覽（不寫入）===');
  console.log(`要還原 ${people.length} 位、共 ${cells} 處：${people.join('、') || '（無）'}`);
  cur.newMembers.forEach((m, i) =>
    console.log(`  ${m.name}  ${cur.new.filter(r => r[i] && r[i][0] === 1).length}/17`));
  if (!WRITE) { console.log('\n加上 --write 才會實際寫入。'); return; }
  if (!cells) { console.log('沒有差異，不寫入。'); return; }

  await fetch(await fb.url(`${FB}/backups_v1.json`), {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ t: Date.now(), by: '導師協調員', reason: '還原在村進度前的備份' })
  });
  const put = await fetch(await fb.url(`${FB}/tracker_v7.json`), {
    method: 'PUT', headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(cur)
  });
  console.log(`\n✔ 已備份　✔ tracker_v7 PUT ${put.status}`);
  await fetch(await fb.url(`${FB}/logs_v1.json`), {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ t: Date.now(), who: '導師協調員', ver: '系統', member: '', item: '',
      act: `🔧 從備份還原在村進度：${people.join('、')}` })
  });
})().catch(e => { console.error('失敗：', e.message); process.exit(1); });
