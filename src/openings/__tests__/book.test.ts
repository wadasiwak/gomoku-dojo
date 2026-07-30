// 開局書查表測試：8 對稱反變換全覆蓋（最容易錯的點）、命中/未命中、
// 兩打書值符號、AI 手番紀律閘門。用真 book.json（26 開局白 4 覆蓋是
// check-opening-book.mjs 保證的資料不變量，測試可倚賴）。
import { describe, expect, it } from 'vitest'
import { bookLookup, bookMoveWithDiscipline, bookOfferValue, BOOK_SIZE } from '../index.ts'
import { INVERSE_SYMMETRY, lookupIn, strToMove, type BookEntry } from '../lookup.ts'
import { OPENINGS, openingMoves } from '../../content/openings.ts'
import { SYMMETRIES, canonicalBoardKey } from '../../engine/symmetry.ts'
import { BLACK, WHITE, SIZE, idx, type Pos } from '../../engine/types.ts'
import book from '../book.json'

const entries = (book as { entries: Record<string, BookEntry> }).entries

const boardKeyAfter = (moves: readonly Pos[], extra: Pos): string => {
  const b = new Uint8Array(SIZE * SIZE)
  moves.forEach((m, i) => {
    b[idx(m.x, m.y)] = i % 2 === 0 ? BLACK : WHITE
  })
  b[idx(extra.x, extra.y)] = moves.length % 2 === 0 ? BLACK : WHITE
  return canonicalBoardKey(b)
}

describe('對稱反變換', () => {
  it('INVERSE_SYMMETRY 是 SYMMETRIES 的逆（全盤 225 點驗證）', () => {
    for (let i = 0; i < SYMMETRIES.length; i++) {
      const t = SYMMETRIES[i]
      const inv = SYMMETRIES[INVERSE_SYMMETRY[i]]
      for (let y = 0; y < SIZE; y++)
        for (let x = 0; x < SIZE; x++) {
          const p = t(x, y)
          expect(inv(p.x, p.y)).toEqual({ x, y })
        }
    }
  })

  it('26 開局 × 8 方位查表全命中，建議手反變換後與書局面同構', () => {
    for (const o of OPENINGS) {
      const m3 = openingMoves(o)
      const base = bookLookup(m3)
      expect(base, `${o.id} 前三手應有書值`).not.toBeNull()
      const baseKey = boardKeyAfter(m3, base!.move)
      for (const t of SYMMETRIES) {
        const rotated = m3.map((m) => t(m.x, m.y))
        const hit = bookLookup(rotated)
        expect(hit, `${o.id} 對稱像應命中`).not.toBeNull()
        // 建議手必須落在空點
        expect(rotated.some((m) => m.x === hit!.move.x && m.y === hit!.move.y)).toBe(false)
        // 分數/深度與方位無關
        expect(hit!.score).toBe(base!.score)
        expect(hit!.depth).toBe(base!.depth)
        // 反變換正確性：落下建議手後的盤面 canonical key 在所有方位一致
        expect(boardKeyAfter(rotated, hit!.move)).toBe(baseKey)
      }
    }
  })
})

describe('命中／未命中', () => {
  it('書非空', () => {
    expect(BOOK_SIZE).toBeGreaterThan(0)
  })

  it('不在書內的手順回 null（角落怪手順）', () => {
    expect(bookLookup([{ x: 0, y: 0 }])).toBeNull()
    expect(
      bookLookup([
        { x: 0, y: 0 },
        { x: 14, y: 14 },
        { x: 0, y: 14 },
      ]),
    ).toBeNull()
  })

  it('lookupIn 對壞資料防呆：建議手撞已占點回 null', () => {
    const moves: Pos[] = [{ x: 7, y: 7 }]
    const key = 'hh' // canonical form of [天元]
    const bad: Record<string, BookEntry> = { [key]: { move: 'hh', score: 0, depth: 1 } }
    expect(lookupIn(bad, moves)).toBeNull()
  })
})

describe('兩打/擇打書值', () => {
  it('bookOfferValue ＝ 落子後局面書值取負（黑視角），且對稱方位一致', () => {
    // 從書裡找一筆 5 手局面（規約兩打點深算條目必然存在）
    const key5 = Object.keys(entries).find((k) => k.length === 10)
    expect(key5).toBeDefined()
    const moves: Pos[] = []
    for (let i = 0; i < key5!.length; i += 2) moves.push(strToMove(key5!.slice(i, i + 2)))
    const m4 = moves.slice(0, 4)
    const c = moves[4]
    const direct = entries[key5!]
    for (const t of SYMMETRIES) {
      const v = bookOfferValue(
        m4.map((m) => t(m.x, m.y)),
        t(c.x, c.y),
      )
      expect(v).toBe(-direct.score)
    }
  })

  it('書未涵蓋的候選回 null', () => {
    const m4: Pos[] = [
      { x: 7, y: 7 },
      { x: 0, y: 0 },
      { x: 14, y: 14 },
      { x: 0, y: 14 },
    ]
    expect(bookOfferValue(m4, { x: 7, y: 8 })).toBeNull()
  })
})

describe('AI 手番紀律閘門', () => {
  const m3 = openingMoves(OPENINGS[0])

  it('gomoku 不查書', async () => {
    expect(await bookMoveWithDiscipline(m3, 'gomoku', WHITE, async () => false)).toBeNull()
  })

  it('手順奇偶不合（沒輪到 aiColor）回 null', async () => {
    expect(await bookMoveWithDiscipline(m3, 'renju', BLACK, async () => false)).toBeNull()
  })

  it('對手有殺 → 不走書（回退搜索防守模式）', async () => {
    expect(await bookMoveWithDiscipline(m3, 'renju', WHITE, async () => true)).toBeNull()
  })

  it('對手無殺 → 回書手（與 bookLookup 一致）', async () => {
    const hit = await bookMoveWithDiscipline(m3, 'renju', WHITE, async () => false)
    expect(hit).toEqual(bookLookup(m3))
    expect(hit).not.toBeNull()
  })
})
