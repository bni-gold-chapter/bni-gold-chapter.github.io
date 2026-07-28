# LINE 官方帳號｜群組聊天自動記錄器

讓公司官方 LINE（例：川果設計 NID DESIGN LAB）加入的**群組聊天內容自動記錄**到 Firebase，
並自動分類為 **📋 工作事項／📞 聯絡事項／💬 一般**，可在網頁上瀏覽、搜尋、匯出 CSV。

```
群組成員發訊息 → LINE 平台 → Webhook（本伺服器，Cloud Run）→ Firebase → 檢視頁
```

- **記錄器程式**：`server.js`（零依賴，Node.js 18+）
- **檢視頁**：https://bni-gold-chapter.github.io/line-logs.html （密碼 8888）

---

## ⚠️ 開始前必知的限制

1. **只能記錄「設定完成之後」的新訊息**。LINE 不提供任何回溯歷史訊息的 API，過去的聊天記錄拿不到。
2. 圖片／影片／檔案只記錄「有人傳了圖片/檔案（含檔名）」，不會下載檔案本身。
3. **請告知群組成員聊天內容會被記錄**（隱私與信任問題，務必先溝通）。
4. Webhook 接收訊息**完全免費**，不占官方帳號的訊息額度（只有「主動發送」才計費）。
5. 開啟 Messaging API 後，官方帳號後台的「聊天」手動回覆功能**仍可同時使用**（兩者可並存）。
6. 目前預設寫入 BNI 追蹤表共用的 Firebase（`bni-tracker-b3ef8`），該資料庫**規則是公開讀寫**——
   公司聊天記錄放在公開資料庫有外洩風險。**正式使用強烈建議另開一個 Firebase 專案**，
   把規則設為僅限伺服器寫入，並用環境變數 `FIREBASE_URL`＋`FIREBASE_SECRET` 指過去。

---

## 設定步驟

### 第 1 步：開通 Messaging API

1. 到 [LINE Official Account Manager](https://manager.line.biz/) → 你的帳號 → **設定 → Messaging API**
   （就是回應設定頁 Webhook 開關下方那個「開啟 Messaging API 的設定畫面」連結）。
2. 依畫面指示建立／連結一個 **LINE Developers Provider**（第一次會要你建立，名稱填公司名即可）。
3. 完成後記下 **Channel secret**（這一頁就看得到）。
4. 到 [LINE Developers Console](https://developers.line.biz/console/) → 該 Channel → **Messaging API** 分頁 →
   最下方 **Channel access token (long-lived)** → 按 **Issue** 發行並記下。

### 第 2 步：允許官方帳號加入群組

LINE Official Account Manager → **設定 → 帳號設定 → 功能切換 → 加入群組或多人聊天室** → 改為「接受邀請加入群組或多人聊天室」。
（沒開這個，官方帳號會拒絕所有群組邀請。）

另外建議到 **設定 → 回應設定** 把「自動回應訊息」**關閉**，避免官方帳號在群組裡自動回罐頭訊息。

### 第 3 步：部署 Webhook 伺服器（Google Cloud Run）

已有 GCP 帳號（紅綠燈檢視表就跑在 Cloud Run 上）。在本資料夾執行：

```bash
gcloud run deploy line-logger \
  --source . \
  --region asia-east1 \
  --allow-unauthenticated \
  --set-env-vars "LINE_CHANNEL_SECRET=第1步的secret,LINE_CHANNEL_ACCESS_TOKEN=第1步的token"
```

部署完成會得到網址，例如 `https://line-logger-xxxx.a.run.app`。

可選環境變數：

| 變數 | 說明 | 預設 |
|---|---|---|
| `FIREBASE_URL` | 要寫入的 Firebase RTDB 網址 | bni-tracker-b3ef8（**建議換掉**，見上方第 6 點） |
| `FIREBASE_SECRET` | Firebase 資料庫密鑰（規則非公開時必填） | 無 |
| `FIREBASE_NODE` | 資料節點名稱 | `linelogs_v1` |

### 第 4 步：設定 Webhook 網址

1. LINE Developers Console → 該 Channel → **Messaging API** 分頁 → **Webhook URL** →
   填入 `https://line-logger-xxxx.a.run.app/webhook`（其實任何路徑都可以，程式不挑）。
2. 按 **Verify**，顯示 Success 即通。
3. 打開 **Use webhook** 開關（或回到 Official Account Manager 的回應設定頁，打開「Webhook」開關——兩邊是同一個設定）。

### 第 5 步：把官方帳號邀進群組

用自己的 LINE 把官方帳號**邀請加入**要記錄的群組。
加入成功後，檢視頁就會出現該群組，之後所有訊息即時入庫。

### 第 6 步：瀏覽記錄

打開 https://bni-gold-chapter.github.io/line-logs.html （密碼 `8888`）：

- 左上下拉選單切換群組
- 分類籤：📋 工作事項／📞 聯絡事項／💬 一般／🔔 系統（加入/退出等事件）
- 關鍵字搜尋（內容或成員名）
- **⬇️ 匯出 CSV**：把目前篩選結果下載成 Excel 可開的表格

> 密碼只是防路人誤入的前端閘門，不是真正的資安防護（資料庫本身公開時，懂技術的人仍可直接讀取）。

---

## 自動分類規則

在 `server.js` 上方的 `WORK_KW` / `CONTACT_KW` 兩個正規表達式：

- **📋 工作事項**：報價、提案、修改、交件、截止、進度、開會、合約、請款、發票、印刷、打樣、驗收⋯
- **📞 聯絡事項**：訊息中含**電話號碼／Email**（自動擷取並顯示），或提到聯絡、窗口、地址、拜訪⋯

要增減關鍵字直接改那兩行後重新部署即可。

---

## Firebase 資料結構

```
linelogs_v1/
├─ groups/<群組ID>/            { name, type, lastAt }
└─ messages/<群組ID>/<自動key>/ { ts, at, user, userId, type, text,
                                  category(工作|聯絡|一般|系統),
                                  hasContact, phone?, email?, messageId? }
```

---

## 本機測試（可選）

```bash
LINE_CHANNEL_SECRET=xxx LINE_CHANNEL_ACCESS_TOKEN=yyy node server.js
# 另開視窗，用 cloudflared 或 ngrok 開一條公開通道給 LINE 打進來：
npx cloudflared tunnel --url http://localhost:8080
```

把產生的網址填到 Webhook URL 即可測試。

## 疑難排解

| 症狀 | 原因 |
|---|---|
| Verify 失敗 | Cloud Run 網址錯／服務沒起來（看 Cloud Run 記錄）；`LINE_CHANNEL_SECRET` 填錯會回 403 |
| 群組訊息沒進來 | Webhook 開關沒開／官方帳號其實不在群組裡／只發了設定前的舊訊息 |
| 成員名稱顯示成一串亂碼 | 該成員未加官方帳號好友且 LINE 不提供其名稱時，以 userId 前 8 碼代替 |
| 檢視頁空白 | 尚無任何群組訊息入庫，或 `FIREBASE_URL`/`FIREBASE_NODE` 與檢視頁內設定不一致 |
