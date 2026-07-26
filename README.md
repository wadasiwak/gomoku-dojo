# 五子棋道場（gomoku-dojo）

連珠（Renju）／無禁手五子棋的規則引擎與 AI，純前端、零後端。
第一階段：**引擎＋單元測試＋極簡 debug 頁**；正式 UI 與題庫是下一階段。

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
| `search.ts` | iterative deepening alpha-beta＋Zobrist 置換表＋限時中斷，難度 4 級 |
| `vcf.ts` | VCF 搜索器（可獨立回答「X 方有無 VCF、主變化為何」，題庫驗證器用） |
| `game.ts` / `record.ts` | 對局狀態機、棋譜序列化（`r1:hhhgii…`，URL 分享用） |
| `worker.ts` / `client.ts` | Web Worker message protocol 與主執行緒封裝 |

測試：`npm run test`（vitest）。禁手測資集在
`src/engine/__tests__/forbidden.test.ts`，30+ 案例全部以 ASCII 建局、
期望值逐格手工推導（測資規約見 `.claude/skills/verify/SKILL.md`）。

## 開發

```bash
npm install
npm run dev      # debug 頁 http://localhost:5310（點格落子、✕=黑禁手點、AI/VCF）
npm run test     # 引擎測試
npm run build    # 產出 dist/
```

## 已知理論極限

RIF 對「兩點禁手互相依賴」的悖論局面另有官方裁定條款；本引擎採純遞迴定義，
在那類人造局面可能與官方裁定不同（實戰不會出現）。VCT 搜索器未實作（下階段）。

## 版權

© 2026 wadasiwak. All rights reserved.
程式碼與引擎實作為原創；連珠規則本身為公有領域的遊戲規則。
