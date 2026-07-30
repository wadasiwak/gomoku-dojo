// 發展模式測試（國手第三課，2026-07-30 實戰：AI 執黑、renju、40 手白勝）。
// 「我通常要攻擊了才會使用三」「單純增加二就好，讓我未來材料變更多」。
// 15 I8（G10H9＋I8 斜活三）與 23 D10（D8D9＋D10 直活三）都是非攻擊期活三：
// 雙方皆無 VCF，衝出去只逼白補 16 F11、24 D11——兩顆擋子後來都長進白的
// 終盤勝形（40 J13 成 G13-J13 活四）。修正前 L2-L4 與固定深度 4 皆重現此病。
//
// ⚠️ 獨立成檔：AI 測試是長時間同步搜索，同一 test file 連續阻塞破 60s 會把
// vitest worker 的 RPC heartbeat 餓死（Timeout calling "onTaskUpdate" 假警報）；
// 拆檔各自 worker、各自通道。
import { describe, it, expect } from 'vitest'
import { boardOfMoves, parseBoard } from '../testutils.ts'
import { BLACK, WHITE, idx, type Pos } from '../types.ts'
import { solveVcf } from '../vcf.ts'
import { search, LEVELS, filterDevelopmentMoves } from '../search.ts'

const GAME3RD_14 = 'H8 I9 G9 F8 G10 F10 G11 G12 H9 H7 F9 E8 G7 G8'
const GAME3RD_22 = GAME3RD_14 + ' I8 F11 D9 E9 D8 H13 E10 I12'
const I8: Pos = { x: 8, y: 7 }
const D10: Pos = { x: 3, y: 5 }

describe('發展模式（國手第三課：要攻擊了才出三，否則囤二囤材料）', () => {
  for (const [label, game, bad] of [
    ['14 手後不重演 15 I8', GAME3RD_14, I8],
    ['22 手後不重演 23 D10', GAME3RD_22, D10],
  ] as const) {
    it(`${label}：L2/L3/L4 進發展模式、換不到優勢的活三被降權且不被選`, () => {
      const b = boardOfMoves(game)
      // 前提自檢：雙方皆無 VCF（非防守局面，前兩輪機制不涵蓋）
      expect(solveVcf(Uint8Array.from(b), BLACK, 'renju', { maxDepth: 12 }).found).toBe(false)
      expect(solveVcf(Uint8Array.from(b), WHITE, 'renju', { maxDepth: 12 }).found).toBe(false)
      for (const level of [2, 3, 4] as const) {
        const opts = { rule: 'renju' as const, ...LEVELS[level] }
        // 引擎依據：發展模式審查把該活三列入降權名單
        const fm = filterDevelopmentMoves(Uint8Array.from(b), BLACK, opts, Date.now() + 10000)
        expect(fm, `L${level} 應有降權對象`).not.toBeNull()
        expect(
          fm!.penalized.has(idx(bad.x, bad.y)),
          `L${level} 審查應降權 (${bad.x},${bad.y})`,
        ).toBe(true)
        const r = search(Uint8Array.from(b), BLACK, opts)
        expect(r.viaDevelopment, `L${level} 應進發展模式`).toBe(true)
        expect(r.move, `L${level} 不應走實戰敗著`).not.toEqual(bad)
        expect(
          fm!.penalized.has(idx(r.move!.x, r.move!.y)),
          `L${level} 所選 (${r.move!.x},${r.move!.y}) 不應是降權強迫手`,
        ).toBe(false)
      }
    }, 60000)

    it(`${label}：自對弈固定深度設定（depth 4 + VCF）亦同`, () => {
      const b = boardOfMoves(game)
      const r = search(Uint8Array.from(b), BLACK, {
        rule: 'renju',
        maxDepth: 4,
        timeLimitMs: 15000,
        width: 14,
        vcfDepth: 6,
      })
      expect(r.viaDevelopment).toBe(true)
      expect(r.move).not.toEqual(bad)
    }, 40000)
  }

  it('正當轉換不被壓死：一手雙活三（單擋擋不完）不入降權名單', () => {
    // 黑下 (5,5) 同時成直活三 (5,5)(5,6)(5,7) 與斜活三 (5,5)(6,6)(7,7)：
    // 白單手至多擋一條，交換後另一條活三仍在 → eval 佔優、自然免罰。
    // （gomoku 規則：renju 黑雙三是禁手，此情境只在無禁手方成立。）
    const { board } = parseBoard(`
      ...............
      ...............
      ...............
      ..........O..O.
      ...............
      .....*.........
      .....XX......O.
      .....X.X.......
      ...............
      ...........O...
      ...............
    `)
    const opts = { rule: 'gomoku' as const, ...LEVELS[3] }
    const fm = filterDevelopmentMoves(Uint8Array.from(board), BLACK, opts, Date.now() + 10000)
    expect(fm).not.toBeNull() // 場上有被降權的單活三候選
    expect(fm!.penalized.has(idx(5, 5))).toBe(false) // 雙三免罰
    expect(fm!.moves.some((m) => m.x === 5 && m.y === 5)).toBe(true)
  }, 20000)

  it('發展模式不影響限時：L3 在 14 手後局面寬裕上限內回手', () => {
    const b = boardOfMoves(GAME3RD_14)
    const t0 = Date.now()
    const r = search(Uint8Array.from(b), BLACK, { rule: 'renju', ...LEVELS[3] })
    expect(r.move).not.toBeNull()
    expect(Date.now() - t0).toBeLessThan(3500)
  }, 10000)
})
