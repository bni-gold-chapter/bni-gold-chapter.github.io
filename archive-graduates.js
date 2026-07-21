// One-time: build the "graduated" archive from existing cloud data.
//  - 邱士傑 : recovered from tracker_v5 backup (old column 0)
//  - 洪倧勝 : moved out of tracker_v6 (old column 1) -> writes tracker_v7 without him
const FB = 'https://bni-tracker-b3ef8-default-rtdb.firebaseio.com';
const stamp = new Date().toLocaleString('zh-TW', { hour12: false }).replace(/-/g, '/');

const META = {
  '邱士傑': { npc: '雜貨舖', ind: '玻璃工程', mentor: '徐子棋', light: 70, miss: '來賓 5位、成交 62萬' },
  '洪倧勝': { npc: '', ind: '鋁門窗', mentor: '陳廷澐', light: 70, miss: '來賓 4位、成交 80萬' }
};

function rec(name, ver, items, note) {
  const m = META[name];
  const done = items.filter(c => c && c[0] === 1).length;
  return { name, ver, npc: m.npc, ind: m.ind, mentor: m.mentor, light: m.light, miss: m.miss,
           note: note || '', items, done, total: items.length, archivedAt: stamp };
}

(async () => {
  // 1) 邱士傑 from v5 backup
  const v5 = await (await fetch(`${FB}/tracker_v5.json`)).json();
  const qCol = v5.old.map(r => r[0]);
  const qNote = (v5.oldNotes || [])[0] || '';
  const qiu = rec('邱士傑', 'old', qCol, qNote);

  // 2) 洪倧勝 from v6 (column 1), and build v7 without him
  const v6 = await (await fetch(`${FB}/tracker_v6.json`)).json();
  const IDX = 1;
  const hCol = v6.old.map(r => r[IDX]);
  const hNote = (v6.oldNotes || [])[IDX] || '';
  const hong = rec('洪倧勝', 'old', hCol, hNote);

  const v7 = {
    old: v6.old.map(r => r.filter((_, i) => i !== IDX)),
    new: v6.new,
    oldNotes: (v6.oldNotes || []).filter((_, i) => i !== IDX),
    newNotes: v6.newNotes || []
  };

  console.log('archive 邱士傑:', qiu.done + '/' + qiu.total, '| note:', qiu.note);
  console.log('archive 洪倧勝:', hong.done + '/' + hong.total, '| note:', hong.note);
  console.log('v7 old:', v7.old.length, 'rows x', v7.old[0].length, 'cols | oldNotes:', JSON.stringify(v7.oldNotes));

  const a = await fetch(`${FB}/archive_v1.json`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify([qiu, hong])
  });
  console.log('PUT archive_v1', a.status);

  const b = await fetch(`${FB}/tracker_v7.json`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(v7)
  });
  console.log('PUT tracker_v7', b.status);
})();
