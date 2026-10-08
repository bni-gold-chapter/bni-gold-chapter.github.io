// 離線備份加密（2026/10/08 起）
//
// 為什麼要加密：這是「公開」repo。備份檔原本是明文 JSON，四加一表的地址、照片、
// 全分會的紅綠燈分數，任何人上 GitHub 都看得到 —— 收緊 Firebase 規則擋住了直接讀資料庫，
// 同一份資料卻從備份檔漏出去。加密後外人只看到亂碼，備份照樣每小時進 git、照樣能還原。
//
// 鑰匙：GitHub Actions secret `BACKUP_KEY`（一句夠長的密語）。**另外抄一份收好**，
// 弄丟就再也打不開備份。絕對不要寫進 repo 或印在 log。
//
// 為什麼是「同樣內容 → 同樣密文」：備份的設計是內容沒變就產生一模一樣的檔案、git 不多 commit。
// 一般加密每次用隨機 IV，密文每次都不同，會變成每小時都有假 commit。所以 IV 由
// HMAC(內容) 決定（同 AES-SIV 的思路）：同樣的內容永遠得到同樣的密文；只會透露
// 「兩份備份內容是否完全相同」，而這件事 git 本來就看得出來。
//
// 指令列（要先設定環境變數 BACKUP_KEY）：
//   node backup-crypt.js decrypt backups/archive_v1.json.enc > archive_v1.json   解開來看／編輯
//   node backup-crypt.js encrypt archive_v1.json backups/archive_v1.json.enc      改完鎖回去
//   node backup-crypt.js check                                                     確認鑰匙能打開所有備份
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MAGIC = 'BNIENC1';
const SALT = 'bni-gold-chapter/offline-backup/v1';   // 固定：同一把鑰匙每次都要導出同一組金鑰
let cached = null;

function keyFrom(pass) {
  pass = (pass == null ? process.env.BACKUP_KEY : pass) || '';
  if (pass.length < 16) {
    throw new Error('沒有設定 BACKUP_KEY（或少於 16 個字）。為了不把個資明文寫進公開 repo，拒絕執行。'
      + '\n　→ repo Settings → Secrets and variables → Actions 新增 BACKUP_KEY');
  }
  if (cached && cached.pass === pass) return cached;
  const k = crypto.scryptSync(pass, SALT, 64, { N: 1 << 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
  cached = { pass, enc: k.subarray(0, 32), mac: k.subarray(32) };
  return cached;
}

function encrypt(text, pass) {
  const k = keyFrom(pass);
  const buf = Buffer.from(text, 'utf8');
  const iv = crypto.createHmac('sha256', k.mac).update(buf).digest().subarray(0, 12);
  const c = crypto.createCipheriv('aes-256-gcm', k.enc, iv);
  const ct = Buffer.concat([c.update(buf), c.final()]);
  const b64 = Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
  return MAGIC + '\n' + b64.replace(/.{1,76}/g, '$&\n');
}

function decrypt(str, pass) {
  const k = keyFrom(pass);
  if (!str.startsWith(MAGIC + '\n')) throw new Error('不是加密備份檔（開頭不是 ' + MAGIC + '）');
  const raw = Buffer.from(str.slice(MAGIC.length + 1).replace(/\s+/g, ''), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', k.enc, raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  try {
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
  } catch (e) {
    throw new Error('解不開：BACKUP_KEY 不對，或檔案損毀');
  }
}

/* 讀某個備份：優先讀加密檔 <base>.enc，沒有才讀舊的明文 <base>（加密上線前留下的）。
   base 是 .json 結尾的路徑，例如 backups/bio_v1.json。找不到回 undefined。 */
function readBackup(base, pass) {
  if (fs.existsSync(base + '.enc')) return JSON.parse(decrypt(fs.readFileSync(base + '.enc', 'utf8'), pass));
  if (fs.existsSync(base)) return JSON.parse(fs.readFileSync(base, 'utf8'));
  return undefined;
}

/* 寫加密備份到 <base>.enc，寫完立刻解回來比對（加密寫壞了要當場知道，不是還原時才發現），
   並刪掉同名的舊明文檔。回傳實際寫入的路徑。 */
function writeBackup(base, text, pass) {
  const out = encrypt(text, pass);
  if (decrypt(out, pass) !== text) throw new Error('加密自我檢查失敗：' + base);
  fs.writeFileSync(base + '.enc', out);
  if (fs.existsSync(base)) fs.unlinkSync(base);
  return base + '.enc';
}

module.exports = { encrypt, decrypt, readBackup, writeBackup, keyFrom };

if (require.main === module) {
  const [cmd, a, b] = process.argv.slice(2);
  try {
    if (cmd === 'decrypt' && a) process.stdout.write(decrypt(fs.readFileSync(a, 'utf8')));
    else if (cmd === 'encrypt' && a && b) {
      const text = fs.readFileSync(a, 'utf8');
      JSON.parse(text);                                    // 不是合法 JSON 就不要鎖進去
      fs.writeFileSync(b, encrypt(text));
      console.error('✔ 已加密寫入 ' + b);
    } else if (cmd === 'check') {
      const dir = path.join(__dirname, 'backups');
      const files = [];
      (function walk(d) { fs.readdirSync(d).forEach(f => { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : f.endsWith('.enc') && files.push(p); }); })(dir);
      files.forEach(f => { JSON.parse(decrypt(fs.readFileSync(f, 'utf8'))); console.log('✔ ' + path.relative(__dirname, f)); });
      console.log(`全部 ${files.length} 個加密備份都打得開。`);
    } else {
      console.error('用法：node backup-crypt.js decrypt <檔.enc> | encrypt <檔.json> <檔.enc> | check（需先設定 BACKUP_KEY）');
      process.exit(2);
    }
  } catch (e) { console.error('❌', e.message); process.exit(1); }
}
