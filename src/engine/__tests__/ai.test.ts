// AI sanity 測試：找一手勝、擋衝四、迴避禁手、難度分級在時限內回手。
import { describe, it, expect } from 'vitest'
import { parseBoard } from '../testutils.ts'
import { BLACK, WHITE, idx, opponent, type Color, type Pos } from '../types.ts'
import { createBoard, type Board } from '../board.ts'
import { isWinningMove } from '../rules.ts'
import { isForbiddenMove } from '../forbidden.ts'
import { generateMoves } from '../movegen.ts'
import { findFoursThrough } from '../threats.ts'
import { solveVcf } from '../vcf.ts'
import { search, LEVELS } from '../search.ts'

describe('走子生成', () => {
  it('空盤回天元', () => {
    const b = createBoard()
    expect(generateMoves(b, BLACK, 'renju', 10)).toEqual([{ x: 7, y: 7, score: 0 }])
  })

  it('renju 黑候選手不含禁手點', () => {
    // (7,7) 是三三禁手（case 16b 同形）
    const { board } = parseBoard(`
      ...............
      ...............
      ...............
      ...............
      ...............
      .......X.......
      .......X.......
      .....XX........
      ...............
      ..O.O.O.O......
    `)
    const moves = generateMoves(board, BLACK, 'renju', 50)
    expect(moves.length).toBeGreaterThan(0)
    expect(moves.some((m) => m.x === 7 && m.y === 7)).toBe(false)
    // gomoku 無禁手 → (7,7) 應在候選中
    const g = generateMoves(board, BLACK, 'gomoku', 50)
    expect(g.some((m) => m.x === 7 && m.y === 7)).toBe(true)
  })
})

describe('AI sanity', () => {
  it('各難度都找到一手勝（黑有活四）且不改盤面', () => {
    const { board } = parseBoard(`
      O.O.O..........
      ...............
      ...............
      ...............
      ...............
      ...............
      ...............
      ....XXXX.......
    `)
    for (const level of [1, 2, 3, 4] as const) {
      const before = [...board]
      const r = search(board, BLACK, { rule: 'renju', ...LEVELS[level] })
      expect([...board]).toEqual(before)
      expect(r.move).not.toBeNull()
      board[idx(r.move!.x, r.move!.y)] = BLACK
      expect(
        isWinningMove(board, r.move!.x, r.move!.y, BLACK, 'renju'),
        `level ${level} 應下成五點，實下 (${r.move!.x},${r.move!.y})`,
      ).toBe(true)
      board[idx(r.move!.x, r.move!.y)] = 0
    }
  }, 30000)

  it('擋對方衝四（唯一成五點必守）', () => {
    const { board } = parseBoard(`
      ...............
      ...............
      ...............
      ...............
      ...............
      ...............
      ...............
      ...XOOOO.......
      ...............
      ...............
      ...............
      ...............
      X.X.X..........
    `)
    const r = search(board, BLACK, { rule: 'renju', ...LEVELS[2] })
    expect(r.move).toEqual({ x: 8, y: 7 })
  }, 10000)

  it('renju 黑的著手永不落禁手點', () => {
    const { board } = parseBoard(`
      ...............
      ...............
      ...............
      ...............
      ...............
      .......X.......
      .......X.......
      .....XX........
      ...............
      ..O.O.O.O......
    `)
    const r = search(board, BLACK, { rule: 'renju', ...LEVELS[1] })
    expect(r.move).not.toBeNull()
    expect(isForbiddenMove(board, r.move!.x, r.move!.y).forbidden).toBe(false)
  }, 10000)

  it('時間限制中斷：限時 600ms 的深搜在寬裕上限內回手', () => {
    const { board } = parseBoard(`
      ...............
      ...............
      ...............
      ...............
      ...............
      ...............
      ...............
      .......XO......
      .......OX......
    `)
    const t0 = Date.now()
    const r = search(board, BLACK, {
      rule: 'gomoku',
      maxDepth: 20,
      timeLimitMs: 600,
      width: 12,
      vcfDepth: 0,
    })
    const elapsed = Date.now() - t0
    expect(r.move).not.toBeNull()
    expect(elapsed).toBeLessThan(3000) // 中斷機制生效（否則 depth 20 會跑到天荒地老）
  }, 10000)

  it('空盤開局下天元', () => {
    const b = createBoard()
    const r = search(b, BLACK, { rule: 'renju', ...LEVELS[1] })
    expect(r.move).toEqual({ x: 7, y: 7 })
  }, 10000)
})

// ── 國手實戰 2026-07-28（AI 執黑、預設 renju）前 34 手 ──
// 白 34 D10 後，白在左下有四連衝 VCF（C10→A10 擋→B8→A7 擋→C8→E8 擋→C11 雙頭四），
// 黑無 VCF ＝ 黑必須防守。實戰 AI 卻走 35 K8（G8H8I8＋K8 跳衝四）逼白 36 J8——
// 衝完白殺原封不動、K8 線報廢，J8 反而接活白右下，最終成為白勝線
// H10-I9-J8-K7-L6 的一員。典型「衝四送對手一顆有連結的子」。
const GAME34 =
  'H8 H9 G7 I9 G9 I7 G8 G6 I8 F8 F9 E10 G11 G10 F10 E11 E9 D8 F12 H12 ' +
  'E13 D14 I6 J5 F13 F11 D13 G13 D9 C9 D12 B10 E7 D10'
const K8: Pos = { x: 10, y: 7 }

function board34(): Board {
  const b = createBoard()
  GAME34.split(' ').forEach((s, i) => {
    const x = s.charCodeAt(0) - 65 // 列字母 A..O → x
    const y = 15 - parseInt(s.slice(1), 10) // 行數字 → 內部 y（上而下）
    b[idx(x, y)] = i % 2 === 0 ? BLACK : WHITE
  })
  return b
}

/** 走完 move（若是衝四，連同對方的被迫擋子）後，對方的 VCF 是否已消解/拖慢
 *  （深度 6 內解不出）。與引擎防守模式同語意，用於驗證所選手是真防守。 */
function breaksFoeVcf(b: Board, move: Pos, color: Color): boolean {
  const foe = opponent(color)
  const bb = Uint8Array.from(b)
  bb[idx(move.x, move.y)] = color
  const fours = findFoursThrough(bb, move.x, move.y, color, color === BLACK)
  const completions = new Set<number>()
  for (const f of fours) for (const c of f.completions) completions.add(c)
  if (completions.size >= 2) return true // 活四/雙四＝勝勢手
  if (completions.size === 1) bb[[...completions][0]] = foe // 衝四交換走完再驗
  return !solveVcf(bb, foe, 'renju', { maxDepth: 6, timeLimitMs: 3000 }).found
}

describe('衝四紀律（國手回饋：不亂衝四）', () => {
  // 黑唯一的成四點是 (6,3)：OXXX. 衝四後白擋 (7,3) 該線即死、毫無後續；
  // 好手是右下發展（黑有 (8,8)(9,8) 活二、白有活二需要牽制）。
  // 黑無 VCF（引擎驗算過）。修正前的引擎在固定深度 4 會選 (6,3)（horizon
  // effect：衝四交換把局面推出視野）；forced-reply extension 後任一深度
  // （1~6 逐一驗算）都不選。
  const POINTLESS_CHONG = `
    ...............
    ...............
    ...............
    ..OXXX.........
    ...............
    ...............
    ...............
    ...............
    ........XX.....
    ......OO.......
    ...............
  `

  it('L3/L4 不選無意義衝四', () => {
    const { board } = parseBoard(POINTLESS_CHONG)
    for (const level of [3, 4] as const) {
      const r = search(Uint8Array.from(board), BLACK, { rule: 'gomoku', ...LEVELS[level] })
      expect(r.move, `L${level} 不應衝 (6,3)`).not.toEqual({ x: 6, y: 3 })
    }
  }, 30000)

  it('固定深度 4（修正前引擎會衝四的設定）也不選無意義衝四', () => {
    const { board } = parseBoard(POINTLESS_CHONG)
    const r = search(Uint8Array.from(board), BLACK, {
      rule: 'gomoku',
      maxDepth: 4,
      timeLimitMs: 30000,
      width: 14,
      vcfDepth: 0,
    })
    expect(r.move).not.toEqual({ x: 6, y: 3 })
  }, 40000)

  it('35 手實戰迴歸：vcfDepth=0 純搜索（偶數深度）也不選 K8 拖延衝四', () => {
    // 延伸額度雙邊分帳的迴歸：共用額度時，root 衝四扣掉的額度會遮蔽
    // 白的四連衝反殺鏈，depth 4 會回頭選 K8。
    const b = board34()
    const r = search(Uint8Array.from(b), BLACK, {
      rule: 'renju',
      maxDepth: 4,
      timeLimitMs: 20000,
      width: 14,
      vcfDepth: 0,
    })
    expect(r.move).not.toEqual(K8)
    expect(breaksFoeVcf(b, r.move!, BLACK)).toBe(true)
  }, 60000)

  it('forced extension 開啟後，衝四素材滿盤的局面限時仍準時回手', () => {
    // 雙方各兩條被單邊擋死的眠三（衝四素材）＋活二；無 VCF、無速勝
    // （引擎驗算過），深搜必然跑滿時限 → 驗證延伸不破壞時間中斷。
    const { board } = parseBoard(`
      ...............
      ...............
      OXXX...........
      ...........O...
      ...........O...
      ...........O...
      .....XX....X...
      ...............
      .........X.....
      .........X.....
      .....OO..X.....
      .........O.....
      XOOO...........
      ....X..........
      ...............
    `)
    for (const color of [BLACK, WHITE] as const) {
      const t0 = Date.now()
      const r = search(Uint8Array.from(board), color, {
        rule: 'gomoku',
        maxDepth: 20,
        timeLimitMs: 600,
        width: 14,
        vcfDepth: 0,
      })
      const elapsed = Date.now() - t0
      expect(r.move).not.toBeNull()
      expect(elapsed).toBeLessThan(3000)
    }
  }, 10000)
})

describe('速度判斷／防守模式（國手框架二輪：比殺的快慢決定攻守）', () => {
  it('35 手實戰迴歸：L2/L3/L4 進防守模式、不走 K8、所選手消解白的 VCF', () => {
    const b = board34()
    // 前提自檢：白有 VCF、黑無 → 黑該防守
    expect(solveVcf(Uint8Array.from(b), WHITE, 'renju', { maxDepth: 6 }).found).toBe(true)
    expect(solveVcf(Uint8Array.from(b), BLACK, 'renju', { maxDepth: 12 }).found).toBe(false)
    for (const level of [2, 3, 4] as const) {
      const r = search(Uint8Array.from(b), BLACK, { rule: 'renju', ...LEVELS[level] })
      expect(r.viaDefense, `L${level} 應進防守模式`).toBe(true)
      expect(r.move, `L${level} 不應走 K8`).not.toEqual(K8)
      expect(
        breaksFoeVcf(b, r.move!, BLACK),
        `L${level} 所選 (${r.move!.x},${r.move!.y}) 應消解白的 VCF`,
      ).toBe(true)
    }
  }, 30000)

  it('35 手實戰迴歸：自對弈固定深度設定（depth 4 + VCF）亦同', () => {
    const b = board34()
    const r = search(Uint8Array.from(b), BLACK, {
      rule: 'renju',
      maxDepth: 4,
      timeLimitMs: 15000,
      width: 14,
      vcfDepth: 6,
    })
    expect(r.viaDefense).toBe(true)
    expect(r.move).not.toEqual(K8)
    expect(breaksFoeVcf(b, r.move!, BLACK)).toBe(true)
  }, 40000)

  it('對手衝四在即（一手殺）時防守模式收斂到唯一擋點', () => {
    // 白 XOOOO：唯一成五點 (8,7)；防守過濾應只留該點（其餘手白直接成五）。
    const { board } = parseBoard(`
      ...............
      ...............
      ...............
      ...............
      ...............
      ...............
      ...............
      ...XOOOO.......
      ...............
      ...............
      ...............
      ...............
      X.X.X..........
    `)
    const r = search(Uint8Array.from(board), BLACK, { rule: 'renju', ...LEVELS[3] })
    expect(r.viaDefense).toBe(true)
    expect(r.move).toEqual({ x: 8, y: 7 })
  }, 10000)
})
