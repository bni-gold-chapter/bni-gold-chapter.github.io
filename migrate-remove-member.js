// Migrate tracker data: drop one member column from the OLD table, preserving all other progress/notes.
// Usage: node migrate-remove-member.js <fromNode> <toNode> <oldMemberIndexToRemove>
const FB = 'https://bni-tracker-b3ef8-default-rtdb.firebaseio.com';

const [, , from, to, idxStr] = process.argv;
const idx = parseInt(idxStr, 10);
if (!from || !to || Number.isNaN(idx)) {
  console.error('usage: node migrate-remove-member.js tracker_v5 tracker_v6 0');
  process.exit(1);
}

(async () => {
  const res = await fetch(`${FB}/${from}.json`);
  const d = await res.json();
  if (!d || !d.old || !d.new) { console.error('source data missing'); process.exit(1); }

  console.log(`source ${from}: old ${d.old.length} rows x ${d.old[0].length} cols, new ${d.new.length} x ${d.new[0].length}`);
  console.log('oldNotes before:', JSON.stringify(d.oldNotes));

  const removedNote = (d.oldNotes || [])[idx];
  const out = {
    old: d.old.map(row => row.filter((_, i) => i !== idx)),
    new: d.new,
    oldNotes: (d.oldNotes || []).filter((_, i) => i !== idx),
    newNotes: d.newNotes || []
  };

  console.log(`removed old column index ${idx} (note was: ${JSON.stringify(removedNote)})`);
  console.log(`result: old ${out.old.length} rows x ${out.old[0].length} cols`);
  console.log('oldNotes after:', JSON.stringify(out.oldNotes));
  // show preserved statuses per remaining member
  const done = out.old[0].map((_, c) => out.old.filter(r => r[c] && r[c][0] === 1).length);
  console.log('completed counts per remaining old member:', done.join(', '));

  const put = await fetch(`${FB}/${to}.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(out)
  });
  console.log('PUT', to, put.status);
})();
