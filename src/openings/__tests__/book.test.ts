// 開局書查表測試：8 對稱反變換全覆蓋（最容易錯的點）、命中/未命中、
// 兩打書值符號、AI 手番紀律閘門。用真 book.json（26 開局白 4 覆蓋是
// check-opening-book.mjs 保證的資料不變量，測試可倚賴）。
import { describe, expect, it } from 'vitest'
import { bookLookup, bookMoveWithDiscipline, bookOfferValue, BOOK_SIZE } from '../index.ts'
import { INVERSE_SYMMETRY, STABLE_MARGIN, lookupIn, lookupStableIn, strToMove, type BookEntry } from '../lookup.ts'
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
    // ⚠️ 單一黑 1 手順現在全盤 225 點皆有書（白 2 全覆蓋，見下方「自由模式白 2」節），
    // miss 案例要用 2 手以上的怪手順。
    expect(
      bookLookup([
        { x: 0, y: 0 },
        { x: 14, y: 14 },
      ]),
    ).toBeNull()
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

describe('自由模式白 2 覆蓋（國手實戰迴歸：書缺白 2 條目、白 2 落到裸搜索）', () => {
  it('黑 1 天元之後白 2 有書，且是貼身手（Chebyshev ≤1）', () => {
    const hit = bookLookup([{ x: 7, y: 7 }])
    expect(hit).not.toBeNull()
    expect(Math.max(Math.abs(hit!.move.x - 7), Math.abs(hit!.move.y - 7))).toBeLessThanOrEqual(1)
  })

  it('黑 1 全盤 225 點皆有白 2 書手（36 個 canonical 條目覆蓋）', () => {
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) {
        const hit = bookLookup([{ x, y }])
        expect(hit, `黑1=(${x},${y}) 白 2 應有書`).not.toBeNull()
        expect(hit!.move.x === x && hit!.move.y === y).toBe(false)
      }
  })

  it('黑 1 落在中央 7×7 時白 2 貼身（≤2）——邊角黑 1 允許往中央走', () => {
    for (let y = 4; y <= 10; y++)
      for (let x = 4; x <= 10; x++) {
        const hit = bookLookup([{ x, y }])!
        expect(
          Math.max(Math.abs(hit.move.x - x), Math.abs(hit.move.y - y)),
          `黑1=(${x},${y}) 白2=${JSON.stringify(hit.move)} 應貼身`,
        ).toBeLessThanOrEqual(2)
      }
  })

  it('白 2 書手之後，黑 3 走中央 5×5 任一點白 4 都有書（鏈到 26 開局條目）', () => {
    const w2 = bookLookup([{ x: 7, y: 7 }])!.move
    for (let x = 5; x <= 9; x++)
      for (let y = 5; y <= 9; y++) {
        if ((x === 7 && y === 7) || (x === w2.x && y === w2.y)) continue
        const hit = bookLookup([{ x: 7, y: 7 }, w2, { x, y }])
        expect(hit, `黑3=(${x},${y}) 白4 應有書`).not.toBeNull()
      }
  })
})

describe('穩健線查表（lookupStableIn，L1-L3 開局用）', () => {
  it('分數接近（等價帶內）時偏好 |score| 最小的均衡線而非最尖銳線', () => {
    // 合成書：直接條目最佳線尖銳（+500），子局面提供均衡替代（對手視角 -450 → 我方 +450，
    // 帶內 |450|<|500|…用不對稱的例子更嚴：我方 +410（帶內）vs +500。
    const e: Record<string, BookEntry> = {
      hh: { move: 'gh', score: 500, depth: 20 }, // 最佳線 (6,7)
      // 子局面 [hh, gg]：對手視角 -410 → 走 gg 的我方視角 +410，帶內且 |410| 較小
      hhgg: { move: 'ii', score: -410, depth: 18 },
    }
    const stable = lookupStableIn(e, [{ x: 7, y: 7 }])
    expect(stable).not.toBeNull()
    expect(stable!.move).toEqual({ x: 6, y: 6 })
    expect(stable!.score).toBe(410)
    // 對照：最佳線查表仍取直接條目
    expect(lookupIn(e, [{ x: 7, y: 7 }])!.move).toEqual({ x: 6, y: 7 })
  })

  it('等價帶外（分差 > STABLE_MARGIN）不為求穩放棄明顯較優的線', () => {
    const e: Record<string, BookEntry> = {
      hh: { move: 'gh', score: 500, depth: 20 },
      hhgg: { move: 'ii', score: -(500 - STABLE_MARGIN - 1), depth: 18 }, // 帶外均衡線
    }
    const stable = lookupStableIn(e, [{ x: 7, y: 7 }])
    expect(stable!.move).toEqual({ x: 6, y: 7 }) // 仍取最佳線
  })

  it('真書：黑 1 天元後穩健線與最佳線都命中、皆為貼身手；穩健線 |score| ≤ 最佳線', () => {
    const stable = lookupStableIn(entries, [{ x: 7, y: 7 }])
    const best = lookupIn(entries, [{ x: 7, y: 7 }])
    expect(stable).not.toBeNull()
    expect(best).not.toBeNull()
    expect(Math.max(Math.abs(stable!.move.x - 7), Math.abs(stable!.move.y - 7))).toBeLessThanOrEqual(1)
    expect(Math.abs(stable!.score)).toBeLessThanOrEqual(Math.abs(best!.score))
  })

  it('書外局面回 null', () => {
    expect(lookupStableIn(entries, [{ x: 0, y: 0 }, { x: 14, y: 14 }])).toBeNull()
  })

  it('紀律閘門 preferStable=true 走穩健線', async () => {
    const viaGate = await bookMoveWithDiscipline([{ x: 7, y: 7 }], 'renju', WHITE, async () => false, true)
    const stable = lookupStableIn(entries, [{ x: 7, y: 7 }])
    expect(viaGate).toEqual(stable)
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
