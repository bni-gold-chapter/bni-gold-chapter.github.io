# BNI GOLD CHAPTER — New Member Onboarding Tracker

> 給 AI 助手（Claude Code / Codex）的維護指南。
> 你正在維護 BNI 全鑫白金分會的「新會員出村檢核追蹤表」。
> 使用者是分會的**導師協調員**（此職務每屆會交接，你的使用者可能不是原開發者）。

## 📌 目前狀態（最後更新 2026/07）

- **正式網址**：https://bni-gold-chapter.github.io/
- **進行中名單**
  - 舊版檢核（15 項）：陳雨震、夏振異、蔡家銘
  - 新版檢核（17 項）：楊有成、許柏祥、余政學、吳至軒
- **已出村封存**：邱士傑、洪倧勝（皆 15/15）
- **目前資料節點**：`tracker_v7`
- 燈號與引薦/來賓/成交數字由 `refdata` 自動帶入，會員出村備註與勾選為人工維護
- 村民唯讀連結：`https://bni-gold-chapter.github.io/?view=<姓名>`（工具列「🔗 村民連結」可產生）

## 系統架構（單頁應用，無後端伺服器）

- **`index.html`**：整個網站（HTML+CSS+JS 單檔）。改完 `git push` 即自動部署（GitHub Pages，約 1–3 分鐘生效）。
- **Firebase Realtime Database**（專案 `bni-tracker-b3ef8`）：
  `https://bni-tracker-b3ef8-default-rtdb.firebaseio.com`，規則永久開放讀寫。
  - `tracker_v7`：進行中檢核資料 `{mlist:1, old:[[狀態,備註]…], new:[…], oldNotes:[], newNotes:[], oldMembers:[…], newMembers:[…]}`；狀態 0=未開始 1=完成 2=進行中。**2026/07 起名單（oldMembers/newMembers）存於節點內**，網頁協調員模式可直接封存／新增，不再需要為名單異動 bump 版本；index.html 內的名單陣列僅作首次種子。**版本號要與 index.html 內的 `KEY` 和 `dbRef` 一致**。
  - `backups_v1`：協調員每次「完成出村／新增村民」前的自動全量備份（含時間、操作者、原因）
  - `archive_v1`：已出村封存（完整檢核快照）
  - `refdata`：紅綠燈檢視表數據（燈號/引薦/來賓/成交/培訓/一對一），依**姓名**對應
  - `logs_v1`：操作紀錄
- **資料來源**：分會紅綠燈檢視表 https://service-2026-937515995986.us-west1.run.app/ （無 CORS，瀏覽器抓不到，必須用腳本抓）

## 常見任務

| 使用者說 | 你要做 |
|---|---|
| 「更新數據」 | **已自動化**：GitHub Actions 每週日 21:30（台灣時間）抓紅綠燈檢視表，內容有變才寫入 refdata（腳本內建變化偵測）。要立即更新：觸發該 workflow（Actions 頁 Run workflow，或由 AI 經 API 觸發）；本機亦可 `node update-refdata.js`。注意：repo 60 天無 commit 時 GitHub 會停用排程，重新啟用即可 |
| 「某某出村了，封存」 | **網頁即可操作**（2026/07 起）：⚙️ 工具 → 協調員模式（密碼 8888）→ 該員 100% 時卡片上的「🎓 完成出村」，會自動備份到 `backups_v1` 再搬進 `archive_v1`。亦可用 `archive-graduates.js` 腳本模式 |
| 「新增會員」 | **網頁即可操作**：協調員模式 → 總覽底部「➕ 新增村民」表單（加入新版 17 項）。刪除（非出村）仍用 `migrate-remove-member.js` 模式搬遷 |
| 「改檢核項目/樣式」 | 直接改 `index.html`，push |
| 「LINE 群組聊天記錄」相關 | 另一獨立功能（公司官方 LINE 群組訊息自動記錄＋工作/聯絡分類）。Webhook 程式在 `line-logger/`（部署 Cloud Run），檢視頁 `line-logs.html`（密碼 8888），資料在 Firebase `linelogs_v1`。詳見 `line-logger/README.md` |

## ⚠️ 鐵則

1. **增刪會員 = 資料搬遷，不是重置。** 導師們有大量真實勾選與備註。流程：讀 `tracker_vN` → 增/刪對應欄（old/new 每列 + oldNotes/newNotes）→ 寫入 `tracker_v(N+1)` → 改 index.html 的成員陣列、`dfltOld/dfltNew` 索引、`KEY`、`dbRef` → 舊節點留作備份。
2. **改任何雲端資料前，先 GET 下來存檔備份。**
3. 打勾符號必須是 `✔︎`（U+2714+U+FE0E），少了變體選擇器 iOS 會顯示成灰色 emoji。
4. html2canvas 不能截離畫面元素（會無聲卡死），暫存容器要放畫面內。
5. 部署驗證：push 後輪詢網址內容確認新程式碼字串出現（CDN 有延遲，最多等 3 分鐘）。

## 交接時要移交的東西

網站網址：**https://bni-gold-chapter.github.io/** （GitHub 組織 `bni-gold-chapter`，網址不含個人帳號，交接後不變）

1. **GitHub**：組織 `bni-gold-chapter` 的 Owner 權限（新任加入 → 舊任退出，網址與資料都不動）
2. **Firebase**：`bni-tracker-b3ef8` 專案的擁有者權限（Google 帳號）
3. 本檔案與 README.md 就是全部文件，看完即可接手
