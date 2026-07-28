// LINE 官方帳號「群組聊天自動記錄器」Webhook 伺服器
// 功能：官方帳號加入的群組內，所有訊息自動寫入 Firebase，
//       並依內容自動分類（工作事項／聯絡事項／一般）。
// 零依賴（Node.js 18+ 內建 fetch/crypto），可直接部署 Cloud Run。
// 用法見同資料夾 README.md。
'use strict';
const http = require('http');
const crypto = require('crypto');

// ── 環境變數 ─────────────────────────────────────────────
const SECRET = process.env.LINE_CHANNEL_SECRET || '';          // 必填：LINE Channel secret（驗證簽章）
const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';     // 必填：Channel access token（查群組/成員名稱）
const FB = (process.env.FIREBASE_URL || 'https://bni-tracker-b3ef8-default-rtdb.firebaseio.com').replace(/\/$/, '');
const FB_AUTH = process.env.FIREBASE_SECRET ? `?auth=${process.env.FIREBASE_SECRET}` : '';
const NODE = process.env.FIREBASE_NODE || 'linelogs_v1';       // 資料節點
const PORT = process.env.PORT || 8080;

if (!SECRET || !TOKEN) console.warn('⚠️ 尚未設定 LINE_CHANNEL_SECRET / LINE_CHANNEL_ACCESS_TOKEN，webhook 將拒絕所有請求');

// ── 自動分類 ─────────────────────────────────────────────
// 命中「工作」關鍵字 → 工作事項；含電話/Email/地址等 → 標記聯絡資訊。
const WORK_KW = /報價|估價|提案|需求|規格|修改|調整|定稿|完稿|交件|交稿|截止|期限|死線|deadline|進度|開會|會議|簡報|合約|簽約|請款|付款|匯款|轉帳|發票|印刷|打樣|樣品|出貨|排程|安排|待辦|任務|案子|專案|驗收|上線|測試|設計稿|logo|LOGO|名片設計|完成|確認一下|麻煩.{0,6}(改|做|處理|確認)/;
const CONTACT_KW = /聯絡|聯繫|窗口|電話|手機|分機|信箱|地址|門市|營業時間|拜訪|會面|見面|約.{0,4}(時間|碰面)|名片|line ?id|LINE ?ID/i;
const PHONE_RX = /(?:09\d{2}[- ]?\d{3}[- ]?\d{3})|(?:0\d{1,2}[- ]?\d{3,4}[- ]?\d{4})/;
const EMAIL_RX = /[\w.+-]+@[\w-]+\.[\w.]+/;

function classify(text) {
  const hasContactInfo = PHONE_RX.test(text) || EMAIL_RX.test(text);
  const work = WORK_KW.test(text);
  const contact = hasContactInfo || CONTACT_KW.test(text);
  return {
    category: work ? '工作' : contact ? '聯絡' : '一般',
    hasContact: contact,
    phone: (text.match(PHONE_RX) || [null])[0],
    email: (text.match(EMAIL_RX) || [null])[0]
  };
}

// ── LINE API：查群組名稱、成員顯示名稱（記憶體快取） ──────
const cache = new Map(); // key → {v, exp}
async function lineGet(path) {
  const hit = cache.get(path);
  if (hit && hit.exp > Date.now()) return hit.v;
  try {
    const r = await fetch('https://api.line.me' + path, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (!r.ok) return null;
    const v = await r.json();
    cache.set(path, { v, exp: Date.now() + 30 * 60e3 });
    return v;
  } catch { return null; }
}
async function chatName(src) {
  if (src.groupId) return (await lineGet(`/v2/bot/group/${src.groupId}/summary`))?.groupName || '（未知群組）';
  if (src.roomId) return '多人聊天室';
  return '一對一聊天';
}
async function userName(src) {
  if (!src.userId) return '（未知成員）';
  let p = null;
  if (src.groupId) p = await lineGet(`/v2/bot/group/${src.groupId}/member/${src.userId}`);
  else if (src.roomId) p = await lineGet(`/v2/bot/room/${src.roomId}/member/${src.userId}`);
  else p = await lineGet(`/v2/bot/profile/${src.userId}`);
  return p?.displayName || src.userId.slice(0, 8) + '…';
}

// ── Firebase 寫入 ─────────────────────────────────────────
const fbPost = (path, body) => fetch(`${FB}/${NODE}/${path}.json${FB_AUTH}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
});
const fbPatch = (path, body) => fetch(`${FB}/${NODE}/${path}.json${FB_AUTH}`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
});

const tw = ts => new Date(ts).toLocaleString('zh-TW', { hour12: false, timeZone: 'Asia/Taipei' });

// ── 事件處理 ─────────────────────────────────────────────
async function handleEvent(ev) {
  const src = ev.source || {};
  const chatId = src.groupId || src.roomId || src.userId;
  if (!chatId) return;

  // 群組資訊（名稱）順手更新，供檢視頁顯示
  fbPatch(`groups/${chatId}`, { name: await chatName(src), type: src.type || 'user', lastAt: tw(ev.timestamp) }).catch(() => {});

  let text = '', type = ev.type, cls = { category: '系統', hasContact: false, phone: null, email: null };

  if (ev.type === 'message') {
    const m = ev.message;
    type = m.type;
    if (m.type === 'text') { text = m.text; cls = classify(m.text); }
    else if (m.type === 'image') text = '[圖片]';
    else if (m.type === 'video') text = '[影片]';
    else if (m.type === 'audio') text = '[語音]';
    else if (m.type === 'file') text = `[檔案] ${m.fileName || ''}`;
    else if (m.type === 'sticker') text = '[貼圖]';
    else if (m.type === 'location') text = `[位置] ${m.address || m.title || ''}`;
    else text = `[${m.type}]`;
    if (m.type !== 'text') cls = { category: '一般', hasContact: false, phone: null, email: null };
  }
  else if (ev.type === 'join') text = '📥 官方帳號加入了這個聊天';
  else if (ev.type === 'leave') text = '📤 官方帳號離開了這個聊天';
  else if (ev.type === 'memberJoined') text = '👋 有新成員加入群組';
  else if (ev.type === 'memberLeft') text = '🚪 有成員離開群組';
  else if (ev.type === 'unsend') text = '↩️ 有訊息被收回';
  else return; // 其他事件（follow/postback…）不記錄

  const rec = {
    ts: ev.timestamp,
    at: tw(ev.timestamp),
    user: ev.type === 'message' ? await userName(src) : '（系統）',
    userId: src.userId || null,
    type, text,
    category: cls.category,
    hasContact: cls.hasContact
  };
  if (cls.phone) rec.phone = cls.phone;
  if (cls.email) rec.email = cls.email;
  if (ev.message?.id) rec.messageId = ev.message.id;

  const r = await fbPost(`messages/${chatId}`, rec);
  if (!r.ok) console.error('Firebase 寫入失敗', r.status, await r.text().catch(() => ''));
}

// ── HTTP 伺服器 ──────────────────────────────────────────
http.createServer((req, res) => {
  if (req.method === 'GET') { res.writeHead(200); return res.end('LINE group logger OK'); }
  if (req.method !== 'POST') { res.writeHead(405); return res.end(); }

  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', async () => {
    // 驗證 LINE 簽章，擋掉偽造請求
    const sig = req.headers['x-line-signature'] || '';
    const mac = crypto.createHmac('sha256', SECRET).update(body).digest('base64');
    const ok = SECRET && sig.length === mac.length &&
      crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(mac));
    if (!ok) { res.writeHead(403); return res.end('bad signature'); }

    try {
      const events = JSON.parse(body).events || [];
      await Promise.allSettled(events.map(handleEvent));
    } catch (e) { console.error('處理失敗：', e.message); }
    res.writeHead(200); res.end('ok'); // 一律回 200，避免 LINE 重送
  });
}).listen(PORT, () => console.log(`listening :${PORT} → ${FB}/${NODE}`));
