# BNI GOLD CHAPTER — 新會員出村檢核追蹤表

BNI 全鑫白金分會．導師協調員監督用的線上檢核追蹤系統。
所有導師共用同一份即時資料，手機／電腦皆可操作。

> 📘 **完整專案紀錄（緣起、開發歷程、技術決策、踩過的坑、交接說明）** → [專案完整紀錄.md](專案完整紀錄.md)
> 🤖 **AI 維護指南** → [CLAUDE.md](CLAUDE.md)

## 🔗 網址

| 用途 | 連結 |
|---|---|
| **導師使用（發給大家的）** | https://bni-gold-chapter.github.io/ |
| 資料來源（分會紅綠燈檢視表） | https://service-2026-937515995986.us-west1.run.app/ |

---

## 功能

- **舊版檢核（15 項）／新版檢核（17 項）** 兩套流程分頁
- **📦 已出村封存**：完成出村的會員移入此區，永久保存完整檢核紀錄
- **電腦整表／手機單人卡片** 自動切換（也可手動切）
- **即時共用**：任何人勾選、填備註，所有導師畫面立即同步（Firebase）
- **📜 操作紀錄**：每次狀態切換與備註修改都記錄時間與操作者
- **🖼 匯出整表圖片**：把目前分頁輸出成 JPG
- **燈號／引薦／來賓／成交** 自動連動分會紅綠燈檢視表數據

---

## 🛠 常用維護指令

> 需要 Node.js。手機版 Claude Code 直接說需求即可，Claude 會執行對應指令。

### 1. 更新紅綠燈數據（最常用）

分會紅綠燈檢視表更新後，執行這個讓追蹤表跟著更新：

```bash
node update-refdata.js
```

抓取 43 位會員的 `trafficLightScore` 與各項尚缺指標 → 寫入 Firebase `refdata`。
**所有開著網頁的導師會即時看到新數據，不需重新整理。**

（`update-refdata.ps1` 是同功能的 Windows PowerShell 版，擇一即可。）

### 2. 會員出村 → 移入封存

```bash
node archive-graduates.js
```

> ⚠️ 此腳本目前是一次性寫死的範例（邱士傑、洪倧勝）。要封存新的人時，
> 請改寫其中的 `META` 與欄位索引，或直接請 Claude 依現況產生新腳本。

### 3. 移除會員（保留其他人資料）

```bash
node migrate-remove-member.js <來源節點> <目標節點> <要移除的索引>
# 例：node migrate-remove-member.js tracker_v6 tracker_v7 1
```

---

## ⚠️ 最重要的規則：增刪會員絕不可重置資料

導師們已經有大量真實勾選與備註。
**新增／刪除會員時，一律用「資料搬遷」，不可以直接 bump 版本重來。**

正確流程：
1. 讀取目前 `tracker_vN` 節點
2. 只增/刪該會員那一欄（`old`/`new` 每列 + `oldNotes`/`newNotes`）
3. 寫入 `tracker_v(N+1)`
4. 同步修改 `index.html` 的 `OLD_MEMBERS`／`NEW_MEMBERS`、`dfltOld`／`dfltNew` 的索引、`KEY` 與 `dbRef` 版本號
5. 舊節點保留當備份，確認無誤後再刪

---

## 🗄 資料結構（Firebase Realtime Database）

專案：`bni-tracker-b3ef8`
網址：`https://bni-tracker-b3ef8-default-rtdb.firebaseio.com`
規則：**永久開放讀寫**（無到期日）

| 節點 | 內容 |
|---|---|
| `tracker_v7` | 目前進行中的檢核資料：`{ old:[[狀態,備註]...], new:[...], oldNotes:[], newNotes:[] }`。狀態 `0`=未開始 `1`=完成 `2`=進行中 |
| `archive_v1` | 已出村封存：每筆含姓名、導師、燈號、完整檢核快照、封存時間 |
| `refdata` | 從紅綠燈檢視表抓來的數據，依姓名對應 `{light, ref, o2o, guest, train, biz}` |
| `logs_v1` | 操作紀錄（時間／操作者／會員／項目／動作） |

---

## 🚀 部署

推到 `main` 就會自動部署（GitHub Pages）：

```bash
git add -A
git commit -m "說明"
git push
```

約 1–3 分鐘後生效。

---

## 📝 開發小陷阱（踩過的坑）

- **打勾符號**必須用 `✔︎`（U+2714 + U+FE0E 變體選擇器）。少了變體選擇器在 iOS 會被當彩色 emoji 顯示成灰色，CSS 顏色套不上去。
- **html2canvas** 對 `left:-99999px` 的離畫面元素會無聲卡死；暫存容器要放在畫面內（`position:fixed` + 高 `z-index`），並加逾時保護。
- 紅綠燈檢視表**沒有開放 CORS**，瀏覽器無法直接抓，只能由腳本在本機／伺服器端抓取後寫入 Firebase。
- PowerShell 5.1 讀 `.ps1` 若無 BOM 會把中文當亂碼 → 腳本內避免中文字面值（Node 版無此問題）。
