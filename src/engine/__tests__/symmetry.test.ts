// 對稱歸一：8 對稱變換的群性質與 canonical key 的不變性。
import { describe, expect, it } from 'vitest'
import { SYMMETRIES, canonicalMovesKey, canonicalBoardKey } from '../symmetry.ts'
import { SIZE, BLACK, WHITE, idx, type Pos } from '../types.ts'
import { createBoard } from '../board.ts'
import { OPENINGS, openingMoves, findOpeningByMoves } from '../../content/openings.ts'

const SAMPLE: Pos[] = [
  { x: 7, y: 7 },
  { x: 8, y: 6 },
  { x: 3, y: 11 },
  { x: 0, y: 0 },
  { x: 14, y: 2 },
]

describe('SYMMETRIES', () => {
  it('共 8 個且皆為棋盤到自身的雙射', () => {
    expect(SYMMETRIES.length).toBe(8)
    for (const t of SYMMETRIES) {
      const seen = new Set<number>()
      for (let y = 0; y < SIZE; y++)
        for (let x = 0; x < SIZE; x++) {
          const p = t(x, y)
          expect(p.x).toBeGreaterThanOrEqual(0)
          expect(p.x).toBeLessThan(SIZE)
          expect(p.y).toBeGreaterThanOrEqual(0)
          expect(p.y).toBeLessThan(SIZE)
          seen.add(idx(p.x, p.y))
        }
      expect(seen.size).toBe(SIZE * SIZE)
    }
  })

  it('兩兩不同（在樣本點上可區分），天元皆為不動點', () => {
    const sigs = new Set(
      SYMMETRIES.map((t) => SAMPLE.map((p) => `${t(p.x, p.y).x},${t(p.x, p.y).y}`).join(';')),
    )
    expect(sigs.size).toBe(8)
    for (const t of SYMMETRIES) expect(t(7, 7)).toEqual({ x: 7, y: 7 })
  })
})

describe('canonicalMovesKey', () => {
  it('對 8 個對稱像不變', () => {
    for (const o of OPENINGS) {
      const base = canonicalMovesKey(openingMoves(o))
      for (const t of SYMMETRIES) {
        const img = openingMoves(o).map((m) => t(m.x, m.y))
        expect(canonicalMovesKey(img)).toBe(base)
      }
    }
  })

  it('26 開局的 key 兩兩相異（獨立珠型）', () => {
    const keys = new Set(OPENINGS.map((o) => canonicalMovesKey(openingMoves(o))))
    expect(keys.size).toBe(26)
  })

  it('手順順序不同 → key 不同（保序）', () => {
    const a = canonicalMovesKey([
      { x: 7, y: 7 },
      { x: 8, y: 6 },
    ])
    const b = canonicalMovesKey([
      { x: 8, y: 6 },
      { x: 7, y: 7 },
    ])
    expect(a).not.toBe(b)
  })
})

describe('canonicalBoardKey', () => {
  const boardWith = (stones: [Pos, number][]): Uint8Array => {
    const b = createBoard()
    for (const [p, c] of stones) b[idx(p.x, p.y)] = c
    return b
  }

  it('對 8 個對稱像不變', () => {
    const stones: [Pos, number][] = [
      [{ x: 7, y: 7 }, BLACK],
      [{ x: 8, y: 6 }, WHITE],
      [{ x: 8, y: 8 }, BLACK],
      [{ x: 2, y: 12 }, WHITE],
    ]
    const base = canonicalBoardKey(boardWith(stones))
    for (const t of SYMMETRIES) {
      const img = boardWith(stones.map(([p, c]) => [t(p.x, p.y), c]))
      expect(canonicalBoardKey(img)).toBe(base)
    }
  })

  it('與落子順序無關（同石頭分佈同 key），分佈不同則 key 不同', () => {
    const a = boardWith([
      [{ x: 7, y: 7 }, BLACK],
      [{ x: 8, y: 6 }, WHITE],
    ])
    const b = boardWith([
      [{ x: 8, y: 6 }, WHITE],
      [{ x: 7, y: 7 }, BLACK],
    ])
    expect(canonicalBoardKey(a)).toBe(canonicalBoardKey(b))
    // (8,6) 斜鄰 vs (7,6) 直鄰：不同對稱類，key 必須不同。
    // （注意 (6,6) 與 (8,6) 互為鏡像＝同 key，不能拿來當反例。）
    const c = boardWith([
      [{ x: 7, y: 7 }, BLACK],
      [{ x: 7, y: 6 }, WHITE],
    ])
    expect(canonicalBoardKey(a)).not.toBe(canonicalBoardKey(c))
  })
})

describe('findOpeningByMoves（26 型比對）', () => {
  it('每型的任意對稱像都對回同一型', () => {
    for (const o of OPENINGS) {
      for (const t of SYMMETRIES) {
        const img = openingMoves(o).map((m) => t(m.x, m.y))
        expect(findOpeningByMoves(img)?.id).toBe(o.id)
      }
    }
  })

  it('非 3 手回 null', () => {
    expect(findOpeningByMoves([{ x: 7, y: 7 }])).toBeNull()
  })
})
