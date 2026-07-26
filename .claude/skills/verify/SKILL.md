---
name: verify
description: 驗證 gomoku-dojo（五子棋道場）改動——啟動/測試指令、禁手測資怎麼加、已知雷點。改完引擎或 UI 後使用。
---

# gomoku-dojo 驗證流程

## 指令

```bash
npm run test      # vitest 全套引擎測試（改引擎必跑，62+ 條）
npm run build     # tsc -b + vite build（fail-fast：不要 pipe 給 grep）
npm run lint      # oxlint
npm run dev       # dev server（port 5310）
npx vite preview --port 5312   # 截圖用（e2e 保留 5311）
node scripts/debug-shot.mjs    # playwright 驅動 debug 頁截圖到 /tmp/gomoku-shots，用 Read 親眼看
```

## Port 表

dev/preview 5310、e2e 5311、截圖 5312。

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
  worker 驗證走 build + debug 頁截圖。
- 引擎測試裡鋪「白方應手」棋子時注意別讓白棋不小心連五（曾踩過：白應手排成一列）。
- 搜索/VCF 函式都保證不留盤面副作用；新增搜索路徑時 TimeUp 例外要在 finally 還原落子。
- `isForbiddenMove` 的遞迴每層都在盤上加假想子、必然終止；`MAX_RECURSION` 只是保險絲，
  觸頂時退回樸素判定（把三當活三）。
