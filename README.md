# BNI GOLD CHAPTER — 新會員出村檢核追蹤表

BNI 全鑫白金分會．導師協調員監督用的線上系統。
所有導師共用同一份即時資料，手機／電腦皆可操作。無伺服器、無後端、零費用。

> 🤝 **接任導師協調員請看這份** → [交接手冊.md](交接手冊.md)（不需程式背景）
> 🚀 **接任者第一次設定** → [接任者-開始這裡.md](接任者-開始這裡.md)（貼給 Claude 就會帶你做完）
> 🤖 **AI／工程維護指南** → [CLAUDE.md](CLAUDE.md)
> 📘 **專案緣起與開發歷程** → [專案完整紀錄.md](專案完整紀錄.md)

## 🔗 網址

| 用途 | 連結 |
|---|---|
| **出村檢核追蹤表**（發給導師） | https://bni-gold-chapter.github.io/ |
| **四加一表**（發給新會員） | https://bni-gold-chapter.github.io/bio.html |
| 村民唯讀總覽 | `https://bni-gold-chapter.github.io/?view=all` |
| 資料來源（分會紅綠燈檢視表） | https://service-2026-937515995986.us-west1.run.app/ |

協調員密碼 `8888`（兩站共用）。

---

## 功能

### `index.html` — 出村檢核追蹤表

- **17 項檢核**，狀態三段循環（未開始／進行中／完成）＋每人備註
- **🏁 全體進度**：所有村民依完成度排序；**📦 已出村封存**：保留完整檢核快照
- **即時共用**：任何人勾選、填備註，所有導師畫面立即同步（Firebase）
- **協調員模式**（密碼解鎖）：100% 時可「🎓 完成出村」封存、底部可「➕ 新增村民」，
  兩者都會先自動備份到 `backups_v1`
- **強制填寫操作者**，同裝置自動記住；**📜 操作紀錄**記下誰在何時改了什麼
- 電腦整表／手機單人卡片自動切換、**🖼 匯出整表圖片**、友善列印
- 燈號／引薦／來賓／成交／培訓／一對一 由 `refdata` 自動帶入

> ⚠️ **舊版 15 項檢核已於 2026/08 停用**（`OLD_MEMBERS` 為空陣列），
> 但 **`OLD_ITEMS` 必須永久保留** —— 封存區有 5 位是舊版會員，
> `renderArchive()` 靠它顯示正確的項目名稱。

### `bio.html` — 四加一表

- 新會員用專屬連結 `bio.html?m=<key>` 填寫，免登入、自動存雲端
- 導師／領導團隊輸入密碼可看全部表單、產生連結
- **匯出 PPT**：瀏覽器用 JSZip 打開 `bio-template.pptx` 換掉 `{{token}}`，版面與原版一致；
  照片與 QRcode 以 `<p:pic>` 注入
- **匯出 PDF**：`slides/` 的 23 張背景圖 + `slides.json` 疊出 1280×720px 橫式投影片，列印即 PDF
- **姓名自動拼音**（CJK 基本區 20924 字威妥瑪對照）、**生日→星座**等連動填寫
- **一鍵英文版**：MyMemory API 翻譯全表，可匯出英文版 PPT／PDF

---

## 🤖 日常維護：直接跟 Claude 說

需要 repo 的寫入權限。Claude 會觸發對應的 GitHub Actions 或直接改程式。

| 你說 | 實際發生的事 |
|---|---|
| 「更新」 | 觸發 `update-refdata.yml`，抓紅綠燈檢視表寫入 `refdata` |
| 「新增村民：姓名／行業／導師／入會時間」 | 觸發 `add-member.yml`（亦可直接用網頁的協調員模式）|
| 「把某某的入會時間改成⋯」 | 觸發 `edit-member.yml` |
| 「改檢核項目／版面／功能」 | 直接改 `index.html` 或 `bio.html` 後 push |

### GitHub Actions

| Workflow | 觸發 | 輸入 |
|---|---|---|
| `update-refdata.yml` | **每週日 21:30 自動** ＋ 手動 | `force`（數據無變化也寫入）|
| `add-member.yml` | 手動 | `members` JSON 陣列 |
| `edit-member.yml` | 手動 | `edits` JSON 陣列（`field`: ind\|mentor\|join\|npc\|note\|name）|
| `backup-firebase.yml` | **每小時自動（有變動才 commit）** ＋ 手動 | 無 —— 匯出整個資料庫到 `backups/` 並 commit |
| `restore-firebase.yml` | 手動 | `node`（節點）＋ `confirm`（把節點名字再打一次）|
| `check-data.yml` | 手動 | 無 —— 唯讀列出雲端各節點現況 |

> ⚠️ repo 連續 **60 天沒有任何 commit**，GitHub 會自動停用排程。偶爾動一下即可。

### 本機腳本（需 Node.js）

```bash
node update-refdata.js          # 抓紅綠燈數據 → Firebase（FORCE=1 強制寫入）
node add-member.js              # 新增村民
node edit-member.js             # 修改村民資料
node archive-graduates.js       # 封存出村（腳本模式，網頁操作更方便）
node migrate-remove-member.js <來源節點> <目標節點> <索引>   # 移除會員
node check-data.js              # 唯讀：列出雲端各節點現況
node backup-firebase.js         # 匯出整個資料庫到 backups/
CONFIRM=<節點> node restore-firebase.js <節點>    # 從 backups/ 還原某節點
```

### 產生器（需 Python + `pip install pypinyin` + LibreOffice）

```bash
python3 tools/build-bio-template.py tools/bio-source.pptx bio-template.pptx
python3 tools/build-slide-view.py bio-template.pptx slides/    # 模板改了就要重跑
python3 tools/build-roman-table.py > 拼音表.txt                 # 貼進 bio.html 的 PY_GROUPS
```

---

## 🗄 資料結構（Firebase Realtime Database）

專案 `bni-tracker-b3ef8`　·　`https://bni-tracker-b3ef8-default-rtdb.firebaseio.com`

| 節點 | 內容 |
|---|---|
| `tracker_v7` | 進行中檢核：`{mlist, old:[[狀態,備註]…], new:[…], oldNotes, newNotes, oldMembers, newMembers}`。狀態 `0`未開始 `1`完成 `2`進行中。**名單存在節點內**，協調員線上增減不需 bump 版本 |
| `archive_v1` | 已出村封存（姓名、導師、燈號、完整檢核快照、封存時間）|
| `refdata` | 紅綠燈數據，依姓名對應 `{light, ref, o2o, guest, train, biz}` |
| `bio_v1` | 四加一表 `{name, data:{欄位…}, createdAt, updatedAt, updatedBy}` |
| `backups_v1` | 出村／新增前的自動全量備份（含時間、操作者、原因）。⚠️ 這是**站內**備份，資料庫整個被清空時會跟著消失 —— 真正的備份在 repo 的 `backups/` |
| `logs_v1` | 操作紀錄 |

> 🔐 **安全現況**：2026/10/07 起資料庫規則已收緊——要（匿名）登入才讀寫得到，
> 根節點不可寫入、主要節點不能被整個刪除。驗收用 `verify-rules.yml`，細節見 [CLAUDE.md](CLAUDE.md)。
>
> 🗃 **離線備份**：`backup-firebase.yml` 每小時把整個資料庫匯出到 `backups/` 並 commit，
> git 歷史就是有版本的備份。要還原用 `restore-firebase.yml`。
> **2026/09 曾整個資料庫被清空**，當時 `backups_v1` 與資料同庫、一起消失 —— 詳見 [CLAUDE.md](CLAUDE.md)。

---

## 🚀 部署

推到 `main` 即自動部署（GitHub Pages），約 1–3 分鐘生效。

---

## 📝 踩過的坑

- **`<a:rPr>` 擷取**：非貪婪比對到 `/>` 會切出沒有結尾的標籤，整份 PPT XML 壞掉。
  LibreOffice 會自動修復所以看起來正常，**PowerPoint 會整頁內容消失**。
  改完一定要用嚴格 XML parser 驗證。
- **表格方框座標不能只用 `<a:tr h>` 算**：那是最小列高，實際渲染會被內容撐高，
  實測差到 67px。`build-slide-view.py` 因此多渲染一張探測圖量實際位置。
- **不要用後行斷言正規式 `(?<=…)`**：舊版 Safari／iPad 載入時就拋 SyntaxError。
- **打勾符號**必須是 `✔︎`（U+2714 + U+FE0E）。少了變體選擇器 iOS 會顯示成灰色 emoji。
- **html2canvas** 對離畫面元素會無聲卡死；暫存容器要放畫面內。
- 紅綠燈檢視表**沒開 CORS**，瀏覽器抓不到，只能由腳本抓取後寫入 Firebase。
- **備份不能跟資料放在同一個資料庫。** `backups_v1` 曾與資料一起被清空，等於沒有備份。
- **備份腳本讀到空值時絕不可覆蓋既有備份**，否則出事後的下一次排程會把備份也清掉。
  要同時處理「節點值是 `null`」和「節點整個不在根節點裡」兩種情況 ——
  只走「雲端有的節點」的迴圈碰不到後者，會安靜地放過去。
- **`dbRef` 監聽會用雲端內容覆寫 `localStorage`**：雲端資料被清空後，各裝置的本機副本
  是唯一的備份來源，而這行覆寫會把它們一台一台消掉。現在覆寫前會先過 `rescueLocal()`。
- PowerShell 5.1 讀無 BOM 的 `.ps1` 會把中文當亂碼 → 腳本內避免中文字面值。

---

## 給 AI 助手

| 你用的工具 | 讀哪一份 |
|---|---|
| Claude Code | `CLAUDE.md`（會自動讀取） |
| OpenAI Codex / ChatGPT | `AGENTS.md`（Codex 會自動讀取；ChatGPT 請把整份貼給它） |

兩份都包含安全規則。**動任何雲端資料前先備份**——這套資料已經遺失過兩次。
