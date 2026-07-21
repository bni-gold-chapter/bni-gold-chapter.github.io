// 手動更新：從「紅綠燈檢視表」抓最新數據 → 寫入 Firebase refdata
// 網頁會即時連動（燈號 / 引薦 / 來賓 / 成交 / 培訓 / 一對一）
// 用法： node update-refdata.js
const BASE = 'https://service-2026-937515995986.us-west1.run.app';
const FB = 'https://bni-tracker-b3ef8-default-rtdb.firebaseio.com';

const num = (s, k) => {
  const m = s.match(new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':(-?[0-9.eE+]+)'));
  return m ? Number(m[1]) : 0;
};

(async () => {
  // 1) 找出目前的 bundle 檔名（每次部署 hash 都會變）
  const idx = await (await fetch(`${BASE}/`)).text();
  const bm = idx.match(/\/assets\/index-[^"]+\.js/);
  if (!bm) throw new Error('找不到 bundle');

  // 2) 下載並解析
  const js = await (await fetch(BASE + bm[0])).text();
  const rx = /\{id:\d+,name:"([^"]+)",scores:\{([^}]*)\}\}/g;
  const members = {};
  let m;
  while ((m = rx.exec(js)) !== null) {
    const [, name, sc] = m;
    members[name] = {
      light: num(sc, 'trafficLightScore'),
      ref: -num(sc, 'rolling6Months_referralDeficitWeekly'),
      o2o: -num(sc, 'rolling6Months_oneToOneDeficitBiweekly'),
      guest: -num(sc, 'rolling6Months_guestDeficit'),
      train: -num(sc, 'rolling6Months_trainingDeficit'),
      biz: -num(sc, 'rolling6Months_businessValueDeficit')
    };
  }
  const count = Object.keys(members).length;
  if (!count) throw new Error('解析不到會員資料（對方網站結構可能改了）');

  // 3) 寫入 Firebase
  const updatedAt = new Date().toLocaleString('zh-TW', { hour12: false });
  const res = await fetch(`${FB}/refdata.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ members, meta: { updatedAt, bundle: bm[0] } })
  });

  console.log(`擷取 ${count} 位會員 → Firebase PUT ${res.status}（${updatedAt}）`);
  Object.entries(members)
    .sort((a, b) => b[1].light - a[1].light)
    .forEach(([n, v]) =>
      console.log(`${n.padEnd(6, '　')} 燈號=${String(v.light).padStart(3)} 引薦缺=${v.ref} 來賓缺=${v.guest} 成交缺=${v.biz} 培訓缺=${v.train} 一對一缺=${v.o2o}`)
    );
})().catch(e => { console.error('失敗：', e.message); process.exit(1); });
