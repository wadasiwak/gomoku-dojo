// 開局質量迴歸（2026-07-31 國手實戰：自由連珠、黑=國手、白=AI L4，13 手黑多路
// VCF 必勝——「明顯是更一開始下不好」）。
//
// 診斷結論（scratch/diag-opening*.mjs + diag-rapfi.mjs，Rapfi 5-10s 量化）：
//   - 實戰 6 個白手全部與 L4 裸搜索實選吻合＝用戶玩 L4；書全程未命中，因為
//     Phase B 只存了「空盤黑 1」與「黑1+白2分支後的黑 3」，漏了長度 1 的 key
//     （黑先第 1 手之後、白 2 手番）——人類執黑時白 2 必然脫書。
//   - 劣化起點＝白 2 F10(5,5)：Rapfi 分差 -161cp（vs 自選 G7）；白 4 起 Rapfi
//     黑方視角已找到必勝（-29963 起），之後白 8/10/12 的引擎選手與 Rapfi 自選
//     一致或同分（分差 ≤10cp）——敗局種子就是白 2 一手＋自由連珠黑先先天黑優。
//   - 修法：補書 'hh' 條目（Rapfi 30s 深算 → G7 貼身斜指，黑 3 走中央 5×5 任一點
//     白 4 都鏈到 26 開局條目）＋開局階段（< BOOK_EARLY_PLIES 手）全難度查書
//     （L1-L3 穩健線偏好，見 lookupStableIn）。
//
// 本檔重演實戰 6 個白手節點，各難度走與 Play.tsx 相同的管線（書閘門＋穩健偏好
// ＋VCF 紀律＋回退搜索），雙指標驗收：
//   (a) 接觸度——與最近黑子的 Chebyshev 距離 ≤2；或
//   (b) Rapfi 等價——著手在離線 Rapfi（5s，黑方視角搜索取負）量測的等價帶
//       allowlist 內（與 Rapfi 自選分差 ≥ -50cp；數字見各節點註解）。
// 白 2 額外釘死「必須出書、必須貼身」——F10 型飄遠手（-161cp）不得再現。
//
// ⚠️ 長同步搜索（L4 4s）放獨立測試檔：vitest worker RPC 心跳會被長同步搜索
// 餓死出假警報，勿併回 ai.test.ts 的快測試群。
import { describe, expect, it } from 'vitest'
import { createBoard } from '../board.ts'
import { BLACK, WHITE, idx, type Pos } from '../types.ts'
import { search, LEVELS } from '../search.ts'
import { solveVcf } from '../vcf.ts'
import { lookupIn, lookupStableIn, type BookEntry } from '../../openings/lookup.ts'
import { BOOK_EARLY_PLIES } from '../../openings/index.ts'
import book from '../../openings/book.json'

const entries = (book as { entries: Record<string, BookEntry> }).entries

/** 實戰譜（黑先交替；座標 0-based，H8=(7,7)）。 */
const GAME: Pos[] = [
  { x: 7, y: 7 }, // 1 H8 黑
  { x: 5, y: 5 }, // 2 F10 白 ← 劣化起點（Rapfi -161cp）
  { x: 7, y: 9 }, // 3 H6 黑
  { x: 4, y: 6 }, // 4 E9 白
  { x: 8, y: 8 }, // 5 I7 黑
  { x: 5, y: 7 }, // 6 F8 白
  { x: 9, y: 7 }, // 7 J8 黑
  { x: 10, y: 6 }, // 8 K9 白
  { x: 7, y: 8 }, // 9 H7 黑
  { x: 7, y: 6 }, // 10 H9 白
  { x: 9, y: 9 }, // 11 J6 黑
  { x: 6, y: 6 }, // 12 G9 白
  { x: 6, y: 10 }, // 13 G5 黑（多路 VCF 必勝）
]

const boardOf = (hist: readonly Pos[]) => {
  const b = createBoard()
  hist.forEach((m, i) => {
    b[idx(m.x, m.y)] = i % 2 === 0 ? BLACK : WHITE
  })
  return b
}

const chebNearestBlack = (m: Pos, hist: readonly Pos[]) => {
  let d = 99
  hist.forEach((s, i) => {
    if (i % 2 === 0) d = Math.min(d, Math.max(Math.abs(m.x - s.x), Math.abs(m.y - s.y)))
  })
  return d
}

/** 與 Play.tsx 同一套 AI 著手管線（書閘門＋穩健偏好＋VCF 紀律＋回退搜索）；
 *  紀律檢查用同參數的同步 solveVcf（Worker 版不進 node 測試）。 */
function aiMove(hist: readonly Pos[], level: 1 | 2 | 3 | 4): { move: Pos; viaBook: boolean } {
  const b = boardOf(hist)
  if (level === 4 || hist.length < BOOK_EARLY_PLIES) {
    const hit = level < 4 ? lookupStableIn(entries, hist) : lookupIn(entries, hist)
    if (hit) {
      const foeVcf = solveVcf(b, BLACK, 'renju', {
        maxDepth: 10,
        timeLimitMs: 500,
        maxNodes: 30000,
      }).found
      if (!foeVcf) return { move: hit.move, viaBook: true }
    }
  }
  const r = search(boardOf(hist), WHITE, { rule: 'renju', ...LEVELS[level] })
  expect(r.move).not.toBeNull()
  return { move: r.move!, viaBook: false }
}

/** Rapfi 離線量測的等價帶 allowlist（scratch/diag-rapfi.mjs；候選下完後黑方 5s
 *  搜索取負＝白視角，備註為與 Rapfi 自選的分差 cp）。 */
const RAPFI_OK: Record<number, Pos[]> = {
  3: [
    { x: 7, y: 8 }, // H7 0（Rapfi 自選）
    { x: 4, y: 6 }, // E9 +10
    { x: 5, y: 4 }, // F11 +29443（黑方 5s 未見殺；其餘皆 -29963 級必敗）
  ],
  5: [
    { x: 6, y: 4 }, // G11 0（Rapfi 自選）
    { x: 3, y: 7 }, // D8 -2
    { x: 7, y: 10 }, // H5 -6
    { x: 7, y: 5 }, // H10 -8
    { x: 5, y: 7 }, // F8 -8
  ],
  7: [
    { x: 6, y: 10 }, // G5 0（Rapfi 自選）
    { x: 10, y: 6 }, // K9 0
  ],
  9: [{ x: 7, y: 6 }], // H9 0（＝Rapfi 自選）
  11: [
    { x: 6, y: 6 }, // G9 0（Rapfi 自選）
    { x: 10, y: 10 }, // K5 -4
  ],
}

describe('國手實戰開局迴歸（13 手敗定譜的 6 個白手節點）', () => {
  it(
    '白 2：全難度必須出書、貼身（F10 飄遠手不得再現）',
    () => {
      const hist = GAME.slice(0, 1)
      for (const lv of [1, 2, 3, 4] as const) {
        const { move, viaBook } = aiMove(hist, lv)
        expect(viaBook, `L${lv} 白 2 應出書（書缺白 2 條目是本次實戰的根因）`).toBe(true)
        expect(
          chebNearestBlack(move, hist),
          `L${lv} 白 2 ${JSON.stringify(move)} 應貼身（≤1）`,
        ).toBeLessThanOrEqual(1)
        // 實戰劣著 F10(5,5)（Rapfi -161cp）與其對稱像不得再現
        expect(Math.abs(move.x - 7) === 2 && Math.abs(move.y - 7) === 2, `L${lv} 不得走對角遠跳`).toBe(false)
      }
    },
    30000,
  )

  for (const k of [3, 5, 7, 9, 11]) {
    it(
      `白第 ${k + 1} 手：不得飄遠脫節（距最近黑子 ≤2，或在 Rapfi 等價帶內）`,
      () => {
        const hist = GAME.slice(0, k)
        for (const lv of [1, 2, 3, 4] as const) {
          const { move } = aiMove(hist, lv)
          const contact = chebNearestBlack(move, hist) <= 2
          const rapfiOk = RAPFI_OK[k].some((p) => p.x === move.x && p.y === move.y)
          expect(
            contact || rapfiOk,
            `L${lv} 白第 ${k + 1} 手 ${JSON.stringify(move)} 距最近黑子 ${chebNearestBlack(move, hist)} 且不在 Rapfi 等價帶`,
          ).toBe(true)
        }
      },
      60000,
    )
  }
})
