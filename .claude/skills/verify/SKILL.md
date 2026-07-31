---
name: verify
description: 驗證 gomoku-dojo（五子棋道場）改動——啟動/測試指令、題庫管線、禁手測資怎麼加、已知雷點。改完引擎、UI 或題庫後使用。
---

# gomoku-dojo 驗證流程

## 指令

```bash
npm run test      # vitest 全套（引擎 62＋題庫判定器 8 條；改引擎/judge 必跑）
npm run build     # tsc -b + vite build（fail-fast：不要 pipe 給 grep）
npm run lint      # oxlint
npm run dev       # dev server（port 5310）
npm run e2e       # 先 build！自起 vite preview :5311、finally kill（scripts/e2e.mjs）
npm run check     # 開局 26 珠型完備性＋題庫全量重驗（一項不過 exit 1）
npm run check:openings         # 只驗 26 開局（秒級，改 openings.ts 先跑這個）
npm run gen:puzzles            # 重產題庫（seed 固定 deterministic，~10 分鐘）
npx vite preview --port 5312   # 截圖用（e2e 保留 5311）
node scripts/shots.mjs         # 桌面+行動版截圖到 /tmp/gomoku-shots，用 Read 親眼看
```

## Port 表

dev/preview 5310、e2e 5311、截圖 5312、Rapfi e2e 5313。

## Rapfi 分析引擎（public/rapfi/＋src/analysis/）

- **artifacts 來源**：自行以 emsdk 編譯 dhbloo/rapfi（GPL-3.0），commit/重編 SOP
  全記在 `public/rapfi/README.md`——版本升級照那份 SOP 重編後覆蓋同名檔即可。
- **驗證指令**：
  ```bash
  node scripts/rapfi-smoke.mjs   # node 直跑 wasm：三個 sanity 案例（空盤/一手成五/禁手）
  node scripts/rapfi-e2e.mjs     # playwright + vite dev:5313，走真 Worker 路徑同三案例
  ```
- **介接雷點**：
  - 只能用**單執行緒** build（`-single`）：多執行緒要 SharedArrayBuffer＝要
    COOP/COEP header，GitHub Pages 靜態站設不了。SIMD 版沒問題。
  - Emscripten glue 是傳統 script（MODULARIZE 全域 `Rapfi` factory），module worker
    沒有 `importScripts` → 載入 glue 的 worker（`public/rapfi/rapfi.worker.js`）必須是
    **classic worker**，放 public/ 不走 Vite bundler。
  - repo 是 `"type": "module"`，node 裡 `require()` 該 glue 會被當 ESM 載而拿不到
    `module.exports` → smoke script 用 `new Function` 以 CJS 語意執行（見
    `scripts/rapfi-smoke.mjs` 的 `loadGlueAsCjs`）。
  - 座標 wire format `x,y`（0-based），輸入輸出同框不翻轉——smoke 案例 2/3 有釘住，
    別被 config.toml 的 `coord_conversion_mode` 嚇到（那只影響 Yixin GUI 模式）。
  - 單執行緒引擎 `sendCommand` 是**同步思考**：worker 會阻塞到出手，中止只能
    terminate worker 重載（`RapfiClient.stop()`）；`analyze()` 內部已佇列化，
    不要並發呼叫繞過佇列。
  - 秒殺/定式手不會輸出 `INFO EVAL/BESTLINE`（`evalText`/`winrate` 是 optional），
    UI 端不可假設必有評分。
  - `rapfi-single-simd128.data`（40MB NNUE 權重）＝懶載入的大頭；首次分析要等下載，
    `preload(onProgress)` 有進度回報。vendored glue 已在 `.oxlintrc.json` 排除 lint。

## 匯入棋譜／資源頁／Rapfi UI（第四波 M4）

- 匯入解析器＝`src/ui/importRecord.ts`（vitest：`src/ui/__tests__/importRecord.test.ts`，
  14 條容錯全路徑）。支援 r1:/g1:/r2:（自帶規則）與通用座標序列（規則由 UI 選單指定）。
  座標＝字母列＋數字行、**行 1 在最下**，與 `coordName` 同一慣例——`coordName` 本體
  已移到 `src/ui/coords.ts`（Replay.tsx 留 re-export 供 Play.tsx 舊匯入點）。
- `#/replay`（無棋譜參數）＝匯入入口頁；ImportBox 成功後 navigate 到
  `#/replay|study/<serialized>`，靠 App 的 route key remount 載入。
- Rapfi 分析 UI＝`src/ui/RapfiPanel.tsx`（Study/Replay 共用）：`positionKey` 變更
  → 作廢在途結果（**不 terminate**，RapfiClient.analyze 佇列自行消化）；「取消」鍵
  才呼叫 `stop()`（terminate worker，下次分析重新初始化、artifacts 走 HTTP cache）。
  不支援 wasm SIMD → 整塊 return null 降級（footer 致謝仍在）。
- e2e 的 Rapfi 步驟：思考時間選 1 秒、`.rapfi-result` timeout 放寬 120s
  （本機 preview 40MB 秒級，慢網才吃得到）；`page.goto` 會整頁 reload、
  Rapfi 單例重載，連續兩步分析屬正常路徑。
- footer 致謝以 `RAPFI_ATTRIBUTION`（src/analysis/rapfi.ts）為單一真相，
  App.tsx 只做原始碼網址轉連結——改致謝文字改那個常數。

## 開局書（src/openings/＋scripts/gen-opening-book.mjs）

- **產書**：`npm run gen:book`（Rapfi WASM node 離線深算，預設 10s/局面、全量
  約 2–3 小時）。**斷點續跑**：進度在 `scratch/opening-book/{entries,cache}.jsonl`
  （append-only，重跑自動跳過已有 key）；可用 `--openings d1,i7` 切子集平行跑
  （多進程共用 jsonl 安全），最後跑一次無參數把 book.json 合併齊全＋補 Phase B。
- **驗書**：`npm run check:book`（結構＋canonical key＋全量合法性雙驗＋26 開局
  覆蓋；驗證邏輯在 `scripts/check-book-lib.mjs`，generator 產書時同一份先驗過）。
- **回爐**：`node scripts/gen-opening-book.mjs --recompute keys.txt --deep-ms 30000`
  （keys.txt 一行一個 canonical key；RIF DB 校驗抓到的偏差局面用這個重算）。
- **查表雷點**：book 的 key 是 `canonicalMovesKey`（8 對稱歸一），命中後建議手要
  **反變換**回實際盤方位——變換/反變換只寫在 `src/openings/lookup.ts` 一處，
  vitest（`src/openings/__tests__/book.test.ts`）8 方位全覆蓋釘住；動對稱程式
  必跑。書分數＝行棋方視角 Rapfi cp（±M 映射 ±29000+），與本站靜態 eval
  **尺度不同，不可混排比較**（Play.tsx 兩打/擇打因此書值/靜態二擇一）。
- **紀律閘門**：AI 走書前先問對手 VCF（`bookMoveWithDiscipline`）——對手有殺
  一律回退搜索防守模式，別讓書手繞過防守紀律。
- **難度閘門（2026-07-31 國手實戰後改）**：`moves.length < BOOK_EARLY_PLIES`（10）的
  開局階段**全難度**查書，L1-L3 走 `lookupStableIn`（等價帶 STABLE_MARGIN=120cp 內
  偏好 |score| 最小的穩健線，避開「書把淺搜帶進尖銳線」的錯配）；中局仍僅 L4 用書。
- **白 2 全覆蓋**：黑 1 的 36 個 canonical 位置各有一筆長度 1 條目（`--recompute` 30s
  補算）——自由模式人類執黑時白 2 才不會落到裸搜索（實戰飄遠手 F10 的根因）。
  改書後 miss 案例測試要用 2 手以上手順（單一黑 1 現在必命中）。
- 開局質量迴歸在 `src/engine/__tests__/opening-quality.test.ts`（長同步搜索獨立檔，
  勿併回 ai.test.ts）：實戰 6 個白手節點 × L1-L4，驗接觸度或 Rapfi 等價帶。
- RIF DB（renju.net）**僅離線校驗**：檔案與比對腳本全在 `scratch/opening-book/`
  （gitignored），絕不進 repo、內容絕不上站。

## 題庫管線

- `scripts/gen-puzzles.mjs`（產題）與 `scripts/check-puzzles.mjs`（重驗）共用
  `scripts/puzzle-verify.mjs`——改驗證邏輯只改這一個檔。
- node 直接跑 TS 引擎（node ≥23 type stripping；引擎 import 都帶 `.ts` 副檔名，
  勿改成無副檔名）。
- **solveVcf 的 truncated 語意雷**：深度預算用盡也會設 `truncated=true`。
  「深度 ≤ d 內無解」的證明只被**節點上限**打破（`r.nodes >= maxNodes`），
  不被深度截斷打破——minVcfDepth / judge 都依此判讀，別「修」回去。
- generator 守方會強制擋成五點與活四點——拿掉會產出滿盤「一手勝」垃圾題。
- 產題 determinism 前提：solver 全部 `timeLimitMs:1e15`＋固定 maxNodes，
  控制流不得依賴牆鐘。

## 禁手測資怎麼加（`src/engine/__tests__/forbidden.test.ts`）

1. 用 ASCII 建局：`X`=黑、`O`=白、`*`=待測黑棋落點（恰一個）；第一行是 y=0、
   每行第一格 x=0，沒寫到的格子皆空。要測邊界效應就把棋型排在字串邊緣。
2. 期望值**必須逐格手工推導**，不確定的案例寧可不收；推導要點：
   - 四＝5 格窗 4 黑 1 空，且補空後是「恰好五連」（窗外緊鄰有黑子→補完變長連→不是四）。
   - 四四數「不同 4 子集合」個數；連四左右兩窗是同一個四；活四也是一個四。
   - 活三＝存在延伸點 E 使其成「活四」（兩個恰五點），且 E 本身非禁手（遞迴）。
   - 優先序：恰五（豁免）> 長連 > 四四 > 三三。
3. 每個案例註解寫清楚考點；有把握程度不同要標註（見檔頭「信心標註」）。
4. 加完跑 `npx vitest run src/engine/__tests__/forbidden.test.ts`。

## 已知雷點

- **vite 8（rolldown）與 vitest 的 vite（rollup）型別互撞**：vitest 設定放獨立的
  `vitest.config.ts`，不要在 `vite.config.ts` 加 `test` 欄位、不要從 `vitest/config`
  import 後又用 vite 的 Plugin 型別。
- **Worker bundle 的版權 banner** 要在 `vite.config.ts` 的 `worker.plugins` 另掛一次。
- `worker.ts` 用了 `self.onmessage`，**不能在 node 端測試 import**（node 無 self），
  worker 驗證走 build + e2e/截圖。judge 測試注入同步版 solveVcf 就不經 worker。
- 引擎測試裡鋪「白方應手」棋子時注意別讓白棋不小心連五（曾踩過：白應手排成一列）。
- 搜索/VCF 函式都保證不留盤面副作用；新增搜索路徑時 TimeUp 例外要在 finally 還原落子。
- `isForbiddenMove` 的遞迴每層都在盤上加假想子、必然終止；`MAX_RECURSION` 只是保險絲，
  觸頂時退回樸素判定（把三當活三）。
- **e2e 測 AI 對弈**別想用固定點擊鋪局（AI 會攪局）：用 `window.__dojo.loadPlay(record)`
  測試 hook 直接載入局面（載入後輪到玩家手番就不會觸發 AI）。r2 規約譜可帶
  `{ player }` 第二參數指定暫定執色；中途規約譜（如 4 手＋兩打）可直接鋪出
  擇打畫面。AI 連續快速回手（擇打＋下一手）會讓 stone 數一口氣跳兩格——
  斷言用 `waitStonesAtLeast` 而非恰等於。
- 對弈頁 AI 觸發用 `pendingRef` key（`gameId:moves.length`；規約決策為
  `gameId:rif:phase:moves.length`）防 StrictMode 雙效應；悔棋前會改 key 使在途
  結果失效——動 AI effect 時保住這兩個機制。搜索 effect 與規約決策 effect 以
  phase 條件互斥，共用同一個 pendingRef，別讓兩者同時成立。
- **26 開局資料（src/content/openings.ts）動任何座標/名稱前先看檔頭查證來源**；
  `check-openings.mjs` 裡有 renju.net 官方圖的獨立轉錄對照表，兩份必須同時改。
- 規約狀態機是純函式（src/rif/protocol.ts）：phase 由 meta＋moves.length 推導，
  不存第二份狀態；Play.tsx 的 playerColor 在規約模式下由 swapped 推導（換邊會
  翻轉），undo 有「不可悔穿第 5 手」下限。
- GoatCounter `path()` 只回報 pathname，e2e 有斷言釘住（hash 會含棋譜/題目參數）。
