// 更新紅綠燈數據 → 寫入 Firebase refdata（網頁即時連動：燈號 / 引薦 / 來賓 / 成交 / 培訓 / 一對一）
// 用法： DASHBOARD_KEY=<金鑰> node update-refdata.js     （FORCE=1 可強制寫入）
//
// 資料來源（2026/10/08 起）：全鑫分會管理網站的「紅綠燈儀表板」
//   https://bnigoldchaptertc.bnigoldchaptertc.workers.dev/dashboard/
// 它背後是分會的 Google Apps Script，用 LINE 領導團隊群組「儀表板」連結裡的金鑰（?k=…）讀取。
// 金鑰放在 GitHub Actions 的 secret `DASHBOARD_KEY`，**絕對不要寫進 repo**（這是公開 repo）。
// 金鑰若換了（Apps Script 回「連結不正確」），到 LINE 群組輸入「儀表板」拿新連結，更新 secret 即可。
//
// 舊來源 service-2026-…run.app（前副主席的 React 檢視表）的數據寫死在網頁程式檔裡，
// 停在 2026/09/24 不再更新 —— 出村檢核表的數字跟儀表板對不上就是因為還在讀它。
// 沒設定 DASHBOARD_KEY 時仍會退回讀舊來源，但會大聲警告。
const DASH_API = 'https://script.google.com/macros/s/AKfycbyrqyy6zxRb4sGmMPOdQTRRgbfdDu5RmaoaOXK0k5xic9XaRdM_lyBDcT5fOUl0v6aCYg/exec';
const OLD_BASE = 'https://service-2026-937515995986.us-west1.run.app';
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

async function fromOldSite() {
  const num = (s, k) => {
    const m = s.match(new RegExp(k + ':(-?[0-9.eE+]+)'));
    return m ? Number(m[1]) : 0;
  };
  const idx = await (await fetch(`${OLD_BASE}/`)).text();
  const bm = idx.match(/\/assets\/index-[^"]+\.js/);
  if (!bm) throw new Error('找不到 bundle');
  const js = await (await fetch(OLD_BASE + bm[0])).text();
  const rx = /\{id:\d+,name:"([^"]+)",scores:\{([^}]*)\}\}/g;
  const members = {};
  let m;
  while ((m = rx.exec(js)) !== null) {
    const s = {};
    ['trafficLightScore', 'rolling6Months_referralDeficitWeekly', 'rolling6Months_oneToOneDeficitBiweekly',
     'rolling6Months_guestDeficit', 'rolling6Months_trainingDeficit', 'rolling6Months_businessValueDeficit']
      .forEach(k => { s[k] = num(m[2], k); });
    members[m[1]] = pick(s);
  }
  return { members, meta: { source: '舊紅綠燈檢視表（停在 2026/09/24）', bundle: bm[0] } };
}

(async () => {
  const key = (process.env.DASHBOARD_KEY || '').trim();
  let got;
  if (key) got = await fromDashboard(key);
  else {
    console.warn('⚠ 沒有設定 DASHBOARD_KEY，退回讀舊紅綠燈檢視表 —— 那裡的數據停在 2026/09/24，不是最新的。');
    got = await fromOldSite();
  }
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
