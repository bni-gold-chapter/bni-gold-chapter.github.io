// 手動補同步紅綠燈數據 → 寫入 Firebase refdata（網頁即時連動：燈號 / 引薦 / 來賓 / 成交 / 培訓 / 一對一）
//
// ★ 2026/10/08 起，平常不需要跑這支：分會中樞（管理網站背後的 Google Apps Script，
//   repo bnigoldchaptertc/bnigoldchaptertc 的 syncOutcheckRefdata_）每週算完紅綠燈後、以及每小時檢查時，
//   會直接把數據寫進 refdata。不經過 LINE、不需要任何金鑰。
//
// 這支只留作「中樞暫時壞掉時的手動補救」：
//   DASHBOARD_KEY=<金鑰> node update-refdata.js     （FORCE=1 可強制寫入）
// 金鑰是 LINE 領導團隊群組「儀表板」連結裡 ?k= 後面那串，放 GitHub secret DASHBOARD_KEY，絕不寫進 repo。
//
// ⚠️ 不再讀前副主席的舊紅綠燈檢視表（service-2026-…run.app）：那份數據寫死在網頁裡、停在 2026/09/24，
//   以前每週日自動抓它，就是出村檢核表數字跟儀表板對不上的原因；再抓只會把中樞同步的新數據蓋回舊的。
const DASH_API = 'https://script.google.com/macros/s/AKfycbyrqyy6zxRb4sGmMPOdQTRRgbfdDu5RmaoaOXK0k5xic9XaRdM_lyBDcT5fOUl0v6aCYg/exec';
const FB = 'https://bni-tracker-b3ef8-default-rtdb.firebaseio.com';
const fb = require('./fb-auth');

/* 兩個來源的欄位名稱相同（儀表板就是照舊檢視表重製的），缺口是負數 → 轉成正的「還缺多少」 */
const pick = s => ({
  light: Number(s.trafficLightScore) || 0,
  ref:   -(Number(s.rolling6Months_referralDeficitWeekly) || 0),
  o2o:   -(Number(s.rolling6Months_oneToOneDeficitBiweekly) || 0),
  guest: -(Number(s.rolling6Months_guestDeficit) || 0),
  train: -(Number(s.rolling6Months_trainingDeficit) || 0),
  biz:   -(Number(s.rolling6Months_businessValueDeficit) || 0)
});

async function fromDashboard(key) {
  const r = await fetch(`${DASH_API}?data=${encodeURIComponent(key)}`, { redirect: 'follow' });
  const t = await r.text();
  let d;
  try { d = JSON.parse(t); } catch (e) { throw new Error('儀表板回應不是 JSON（Apps Script 可能正在更新，稍後再試）：' + t.slice(0, 120)); }
  if (d.error) throw new Error(`儀表板拒絕：${d.error}\n　→ 金鑰可能換了：到 LINE 領導團隊群組輸入「儀表板」，把新連結 ?k= 後面那串更新到 GitHub secret DASHBOARD_KEY`);
  if (!Array.isArray(d.members) || !d.members.length) throw new Error('儀表板沒有會員資料（結構可能改了）');
  const members = {};
  d.members.forEach(m => { if (m && m.name && m.scores) members[m.name] = pick(m.scores); });
  return { members, meta: { source: '紅綠燈儀表板', period: d.period || '', sourceUpdated: d.updated || '' } };
}

(async () => {
  const key = (process.env.DASHBOARD_KEY || '').trim();
  if (!key) {
    console.log('紅綠燈數據由分會中樞自動同步（每週更新後＋每小時檢查），這裡不需要執行。');
    console.log('中樞故障要手動補同步時，才需要設定 GitHub secret DASHBOARD_KEY 再執行。');
    return;   // 不寫入：絕不拿舊數據蓋掉中樞同步的新數據
  }
  const got = await fromDashboard(key);
  const { members } = got;
  const count = Object.keys(members).length;
  if (!count) throw new Error('解析不到會員資料（對方網站結構可能改了）');

  // 偵測變化：與雲端現有數據相同就略過寫入（排程自動執行用）
  const stable = x => Array.isArray(x) ? '[' + x.map(stable).join(',') + ']'
    : (x && typeof x === 'object') ? '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + stable(x[k])).join(',') + '}'
    : JSON.stringify(x);
  if (!process.env.FORCE) {
    try {
      const cur = await (await fetch(await fb.url(`${FB}/refdata/members.json`))).json();
      if (cur && stable(cur) === stable(members)) {
        console.log(`數據無變化（${count} 位會員，來源：${got.meta.source}），略過寫入。`);
        return;
      }
    } catch (e) { /* 讀不到現有數據就直接寫入 */ }
  }

  const updatedAt = new Date().toLocaleString('zh-TW', { hour12: false, timeZone: 'Asia/Taipei' });
  const res = await fetch(await fb.url(`${FB}/refdata.json`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ members, meta: Object.assign({ updatedAt }, got.meta) })
  });
  if (!res.ok) throw new Error(`寫入 Firebase 失敗：HTTP ${res.status}`);
  console.log(`來源：${got.meta.source}${got.meta.period ? '　資料期間 ' + got.meta.period : ''}`);
  console.log(`擷取 ${count} 位會員 → Firebase PUT ${res.status}（${updatedAt}）`);

  // Actions 的 log 在公開 repo 裡誰都看得到：只印出村檢核表上的在村新會員（追蹤表本來就顯示他們的燈號），
  // 不把全分會每個人的分數印出來。
  let village = [];
  try {
    const nm = await (await fetch(await fb.url(`${FB}/tracker_v7/newMembers.json`))).json();
    village = (Array.isArray(nm) ? nm : []).map(x => x && x.name).filter(Boolean);
  } catch (e) { /* 讀不到名單就只印總數 */ }
  village.forEach(n => {
    const v = members[n];
    console.log(v
      ? `${n.padEnd(6, '　')} 燈號=${String(v.light).padStart(3)} 引薦缺=${v.ref} 來賓缺=${v.guest} 成交缺=${v.biz} 培訓缺=${v.train} 一對一缺=${v.o2o}`
      : `${n.padEnd(6, '　')} （紅綠燈資料裡找不到這個名字）`);
  });
})().catch(e => { console.error('失敗：', e.message); process.exit(1); });
