// 收緊 Firebase 規則之後，驗證規則「真的生效」而且「沒有把自己鎖在外面」。
//
// 只讀不刪：全程不碰任何真實資料節點。唯一的寫入是往 /_ruletest 這個
// 不存在的暫用節點丟一個數字 —— 規則正確時它會被根節點的 .write:false 擋下來，
// 什麼都不會留下；萬一規則還沒套用而寫進去了，立刻刪掉並報告「規則未生效」。
//
// 用法：node verify-rules.js
const FB = 'https://bni-tracker-b3ef8-default-rtdb.firebaseio.com';
const fb = require('./fb-auth');

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? '✅' : '❌'} ${name}${detail ? '　→ ' + detail : ''}`);
};
const denied = t => /permission|denied/i.test(t || '');

(async () => {
  // 1) 沒有登入的人讀不讀得到？（這就是「無痕視窗直接打網址」那一題）
  {
    const r = await fetch(`${FB}/bio_v1.json`);           // 不帶 auth
    const t = await r.text();
    check('未登入者讀不到 bio_v1（個資不外洩）',
          r.status === 401 || denied(t),
          `HTTP ${r.status} ${t.slice(0, 60)}`);
  }

  // 2) 匿名登入之後讀得到？（網頁與腳本要靠這個）
  {
    const r = await fetch(await fb.url(`${FB}/tracker_v7/newMembers.json`));
    const t = await r.text();
    let n = -1; try { n = (JSON.parse(t) || []).length; } catch (e) {}
    check('匿名登入後讀得到 tracker_v7（網頁不會壞）', r.ok && n > 0, `讀到 ${n} 位村民`);
  }

  {
    const r = await fetch(await fb.url(`${FB}/bio_v1.json?shallow=true`));
    const t = await r.text();
    let n = -1; try { const v = JSON.parse(t); n = v ? Object.keys(v).length : 0; } catch (e) {}
    check('匿名登入後讀得到 bio_v1（四加一表不會壞）', r.ok && n >= 0, `讀到 ${n} 筆`);
  }

  // 3) 根節點是不是真的鎖住了？—— 這是整個修正的重點。
  //    根節點若還放行，底下每個節點的 newData.exists() 保護全部形同虛設。
  {
    const u = await fb.url(`${FB}/_ruletest.json`);
    const r = await fetch(u, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '1' });
    const t = await r.text();
    const blocked = !r.ok && denied(t);
    check('根節點不可寫入（底下的保護才有意義）', blocked, blocked ? '寫入被擋下' : `⚠ 竟然寫得進去：HTTP ${r.status}`);
    if (!blocked) {
      // 規則還沒套用。把剛才留下的垃圾清掉，不要污染資料庫。
      await fetch(u, { method: 'DELETE' }).catch(() => {});
      console.log('   （已清除剛才寫入的 /_ruletest；這代表規則尚未套用或根節點仍放行）');
    }
  }

  console.log('');
  const bad = results.filter(r => !r.pass);
  if (bad.length) {
    console.log(`🚨 ${bad.length} 項未通過：${bad.map(b => b.name).join('、')}`);
    console.log('   規則若剛貼上卻沒過，請立刻回滾：主控台 → 規則 → 改回');
    console.log('   {"rules":{".read":true,".write":true}} → 發布（一分鐘內生效）');
    process.exit(1);
  }
  console.log('🎉 全部通過：外人讀不到、自己人讀得到、根節點鎖住了。');
})().catch(e => { console.error('❌ 驗證過程出錯：', e.message); process.exit(1); });
