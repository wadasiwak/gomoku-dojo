# 五子棋道場（gomoku-dojo）

連珠（Renju）／無禁手五子棋：規則引擎、四級 AI、VCF 題庫闖關、棋譜重播。
純前端、零後端，所有計算（含 AI 與題目判定）都在瀏覽器裡完成。

## 功能

- **對弈**：規則切換（連珠禁手 / 無禁手）、先後手自選、AI 難度 4 級
  （Web Worker 搜索不卡 UI）、連珠模式即時標記黑禁手點 ✕（可開關）、
  悔棋（悔到自己上一手）、認輸/重開；對局結束記戰績（分規則×難度）
  並自動存入棋譜庫。
- **題庫闖關**：VCF（連續衝四取勝）題庫，依最小 VCF 深度分
  初級（2–3 手）/中級（4–7 手）/高級（8+ 手）。答題判定用引擎**即時驗證**
  而非死背唯一解——走出另一條同樣成立的 VCF 也算對；守方由引擎最強回擋。
  判錯進錯題本，無錯通關連對 2 次出本。
- **棋譜重播＋自由研棋**：前進/後退/跳到任一手；停在任一手直接點棋盤即
  岔出變化試下（黑白輪替、可悔一手/整段收掉，不改動原棋譜），並可按
  「AI 建議」讓引擎標出目前局面它會下哪。分享連結把棋譜序列化進 URL hash
  （`#/replay/r1:hhhgii…`），還原走嚴格驗證（格式/範圍/重複/逐手合法）。
- **擺譜研究**：自由擺子建局（黑/白/清除，不限手順）再從指定手番開始試下，
  隨時按「AI 建議」（難度可選）；連珠模式試下含禁手判負與全盤禁手點 ✕。
- **棋譜匯入**：重播（`#/replay`）與擺譜頁貼上即匯入——支援本站棋譜
  （`r1:`/`g1:`/`r2:`）與通用座標序列（`h8 i9 g9`，容忍大小寫／逗號／空白／
  換行分隔，行 1 在最下），逐手照對局規則嚴格驗證（重複／越界／終局後多餘
  著手都行內指出第幾手壞掉）。
- **Rapfi 分析**：擺譜與重播研棋可呼叫 Gomocup 冠軍級 [Rapfi](https://github.com/dhbloo/rapfi)
  引擎（WASM，獨立 Worker）做第二意見——思考 1/3/10 秒、建議手 hint 圈＋
  評分/勝率/主變化。首次使用下載 40MB NNUE 權重（進度條），之後走瀏覽器
  快取；不支援 wasm SIMD 的瀏覽器自動隱藏。對弈預設仍為本站原創引擎。
- **AI 開局書**：對弈 AI 的開局前若干手查離線深算的開局書（`src/openings/book.json`，
  Rapfi 引擎自產、每筆經本站引擎合法性雙驗）——涵蓋 26 開局的規約路徑
  （白 4 分支×黑五手兩打打點×主變化延伸）與自由模式黑先主流分支。查表以
  8 對稱歸一命中、建議手反變換回實際方位；正式規約的兩打／擇打改用書值，
  對手有殺時不走書（回退搜索防守模式）。書手在介面標「開局書」，設定可關。
  重算：`npm run gen:book`（斷點續跑）、全量重驗：`npm run check:book`。
- **規則科普**：禁手三型（長連/三三/四四）例圖，✕ 的判定由引擎現場計算。
- **資源頁**：介紹並外連 renju.net（RIF 官方）、587.renju.org.tw（台灣連珠
  推廣）、gomocalc.com（線上 Rapfi 分析）。

## 規則模式

- **gomoku（無禁手 / free-style）**：黑白任一方連成 ≥5 即勝（含長連）。
- **renju（連珠）**：黑方有禁手——長連（>5）、三三（一手兩個以上真活三）、
  四四（一手兩個以上的四，含同線跳四）；白方無禁手且長連算勝；黑方踩禁手判負。
  - 活三採嚴格遞迴定義：延伸點本身是禁手 → 該三不是活三。
  - 五連豁免：一手同時成恰好五連與禁手形 → 黑勝。
  - 判定理由優先序：五連 > 長連 > 四四 > 三三。

## 引擎（`src/engine/`，純 TS 零依賴，可在 Web Worker 跑）

| 模組 | 內容 |
| --- | --- |
| `board.ts` / `rules.ts` | 15×15 棋盤、落子/悔棋、五連/長連判定（黑恰五 vs 白 ≥5） |
| `threats.ts` | 四（衝四/活四）偵測，禁手與 VCF 共用 |
| `forbidden.ts` | 連珠禁手判定（含真活三遞迴、全盤禁手點掃描） |
| `eval.ts` / `movegen.ts` | 棋型計數評估、鄰域候選＋威脅點排序 |
| `search.ts` | iterative deepening alpha-beta＋Zobrist 置換表＋限時中斷，難度 4 級；三態出手紀律：VCF 殺著即走／防守模式（對手有殺→候選限縮）／發展模式（雙方無殺→換不到優勢的強迫手降權，囤活二） |
| `vcf.ts` | VCF 搜索器（可獨立回答「X 方有無 VCF、主變化為何」，題庫驗證器用） |
| `game.ts` / `record.ts` | 對局狀態機、棋譜序列化（`r1:hhhgii…`，URL 分享用） |
| `worker.ts` / `client.ts` | Web Worker message protocol 與主執行緒封裝 |

`src/puzzle/judge.ts` 是題庫答題判定器（攻方每手須成五或成四；衝四由引擎
代守回擋後驗證 VCF 仍在；活四/雙四與逼禁手直接判勝）。

## 題庫管線（`scripts/`）

```bash
npm run gen:puzzles   # 離線產題：引擎自對弈（seed 固定、無時鐘依賴 → deterministic）
                      # 每題 solveVcf 驗證 + 由淺至深證明「最小 VCF 深度」
npm run check         # 全量重驗：重播棋譜→重求最小深度→比對標註，一題不過就 exit 1
```

產出 `src/puzzles/puzzles.json`：每題含 `rule` / `attacker` / `record`
（到達局面的完整棋譜，重播即得合法盤面）/ `vcfDepth`（已證明的最小深度）/
`difficulty` / `solution`（主變化）/ `verify`（驗證參數）。
generator 與 check 共用 `scripts/puzzle-verify.mjs`（單一真相）。

## 開發

```bash
npm install
npm run dev      # http://localhost:5310
npm run test     # vitest：引擎 77 條＋題庫判定器 8 條
npm run build    # tsc -b + vite build
npm run e2e      # 需先 build；自起 vite preview :5311，跑完自動關
node scripts/shots.mjs   # 桌面+行動版截圖（先起 preview :5312）
```

測試：禁手測資集在 `src/engine/__tests__/forbidden.test.ts`，30+ 案例全部以
ASCII 建局、期望值逐格手工推導（測資規約見 `.claude/skills/verify/SKILL.md`）。

## 已知理論極限

RIF 對「兩點禁手互相依賴」的悖論局面另有官方裁定條款；本引擎採純遞迴定義，
在那類人造局面可能與官方裁定不同（實戰不會出現）。VCT 搜索器未實作。

## 版權

© 2026 wadasiwak. All rights reserved.
程式碼、引擎實作與題庫皆為原創；連珠規則本身為公有領域的遊戲規則。

- 開局書與開局資料由本站引擎自行計算產生；本站**未使用 renju.net 對局資料庫
  的內容上站**（該資料庫授權為非商業、僅限離線使用），外部資源僅介紹與連結、
  不轉載。
- 分析引擎 [Rapfi](https://github.com/dhbloo/rapfi) © dhbloo，**GPL-3.0**：
  以未修改的原始碼自行編譯為 WASM、以獨立 Worker 掛載（與本站引擎完全分離）。
  授權全文在 `public/rapfi/LICENSE`，版本與重編 SOP 在 `public/rapfi/README.md`；
  站內 footer 與資源頁均附致謝與原始碼連結。
