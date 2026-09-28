// 取得 Firebase 匿名登入 token，讓維護腳本在資料庫規則收緊（要求 auth != null）
// 之後仍然讀寫得到。用的是網頁裡同一把公開 apiKey，不需要額外的密鑰或 GitHub Secret。
//
// 取不到 token 就回空字串，網址原樣送出 —— 規則還開著的時候一切照舊，
// 不會因為這一層而擋住腳本。這讓程式可以先上線、確認沒問題，再回主控台收緊規則。
const API_KEY = 'AIzaSyA9zxiowhwSmWF0hFgemvJiyeofEDvQs1o';
const SIGNUP = 'https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + API_KEY;

let cached = null;

async function token() {
  if (cached !== null) return cached;
  try {
    const r = await fetch(SIGNUP, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnSecureToken: true })
    });
    const j = await r.json();
    cached = j.idToken || '';
    if (!cached) {
      console.warn('匿名登入未取得 token：', (j.error && j.error.message) || '未知原因');
      console.warn('（規則若已收緊，接下來的寫入會失敗；請確認主控台已啟用匿名登入）');
    }
  } catch (e) {
    cached = '';
    console.warn('匿名登入失敗：', e.message);
  }
  return cached;
}

/** 把 ?auth=<token> 接到 Firebase REST 網址上；沒有 token 就原樣回傳 */
async function url(base) {
  const t = await token();
  if (!t) return base;
  return base + (base.includes('?') ? '&' : '?') + 'auth=' + encodeURIComponent(t);
}

module.exports = { token, url };
