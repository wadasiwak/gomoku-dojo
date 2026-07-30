// RIF 規約 reducer 全路徑：擺開局驗證/換邊兩分支/兩打（含不等價檢查）/擇打/
// 正常輪替，以及 record v2 序列化 round-trip 與竄改拒絕。
import { describe, expect, it } from 'vitest'
import {
  rifInitial,
  rifReduce,
  rifPhase,
  rifRecord,
  rifStateFromRecord,
  finalColor,
  offersEquivalent,
  type RifState,
  type RifAction,
} from '../protocol.ts'
import { parseRecord, serializeRecord } from '../../engine/record.ts'
import { BLACK, WHITE, type Pos } from '../../engine/types.ts'

const P = (x: number, y: number): Pos => ({ x, y })

/** 依序套用動作；預期全部合法。 */
function apply(state: RifState, ...actions: RifAction[]): RifState {
  let s = state
  for (const a of actions) {
    const { next, error } = rifReduce(s, a)
    expect(error).toBeNull()
    s = next
  }
  return s
}

const expectError = (s: RifState, a: RifAction, pattern: RegExp) => {
  const { next, error } = rifReduce(s, a)
  expect(error).toMatch(pattern)
  expect(next).toBe(s) // 非法動作 state 不動
}

// 浦月（i7）：h8, i9, i7 → 內部座標 (7,7),(8,6),(8,8)
const HOGETSU = [P(7, 7), P(8, 6), P(8, 8)]

describe('rifReduce：開局擺子驗證', () => {
  it('第 1 手必須天元', () => {
    expectError(rifInitial(), { type: 'place', pos: P(7, 6) }, /天元/)
  })

  it('第 2 手必須中央 3×3', () => {
    const s = apply(rifInitial(), { type: 'place', pos: P(7, 7) })
    expectError(s, { type: 'place', pos: P(5, 5) }, /3×3/)
  })

  it('第 3 手必須中央 5×5、不可重複落子', () => {
    const s = apply(
      rifInitial(),
      { type: 'place', pos: P(7, 7) },
      { type: 'place', pos: P(8, 6) },
    )
    expectError(s, { type: 'place', pos: P(10, 7) }, /5×5/)
    expectError(s, { type: 'place', pos: P(8, 6) }, /已有棋子/)
  })

  it('合法前三手 → 比對出開局 id（含對稱方位）', () => {
    const s = apply(rifInitial(), ...HOGETSU.map((pos) => ({ type: 'place', pos }) as const))
    expect(s.meta.openingId).toBe('i7')
    expect(rifPhase(s)).toBe('swap')
    // 花月的上下鏡像：(7,7),(7,8),(8,8) 也要對回 d4
    const t = apply(
      rifInitial(),
      { type: 'place', pos: P(7, 7) },
      { type: 'place', pos: P(7, 8) },
      { type: 'place', pos: P(8, 8) },
    )
    expect(t.meta.openingId).toBe('d4')
  })
})

describe('rifReduce：換邊 → 白4 → 兩打 → 擇打 → 正常輪替', () => {
  const opened = apply(
    rifInitial(),
    ...HOGETSU.map((pos) => ({ type: 'place', pos }) as const),
  )

  it('換邊兩分支：最終執色互換', () => {
    expect(finalColor(BLACK, false)).toBe(BLACK)
    expect(finalColor(BLACK, true)).toBe(WHITE)
    expect(finalColor(WHITE, true)).toBe(BLACK)
    expect(finalColor(WHITE, null)).toBe(WHITE)
    const noSwap = apply(opened, { type: 'swap', swap: false })
    expect(rifPhase(noSwap)).toBe('move4')
    const swap = apply(opened, { type: 'swap', swap: true })
    expect(swap.meta.swapped).toBe(true)
  })

  it('換邊階段不可落子/兩打；非換邊階段不可 swap', () => {
    expectError(opened, { type: 'place', pos: P(9, 6) }, /不是落子階段/)
    expectError(opened, { type: 'offer', a: P(6, 8), b: P(9, 9) }, /不是黑方兩打/)
    expectError(rifInitial(), { type: 'swap', swap: true }, /不是換邊/)
  })

  const at4 = apply(opened, { type: 'swap', swap: false }, { type: 'place', pos: P(9, 6) })

  it('白4 後進兩打階段；兩打驗證（同點/占用/對稱等價）', () => {
    expect(rifPhase(at4)).toBe('offer5')
    expectError(at4, { type: 'offer', a: P(6, 8), b: P(6, 8) }, /兩個不同的點/)
    expectError(at4, { type: 'offer', a: P(7, 7), b: P(6, 8) }, /已有棋子/)
  })

  it('對稱等價的兩打被拒（寒星＋白4 同在中線 → 左右鏡像點等價）', () => {
    // 寒星 h8,h9,h10 + 白4 h11：全部在 x=7 直線上，盤面左右對稱
    const kansei = apply(
      rifInitial(),
      { type: 'place', pos: P(7, 7) },
      { type: 'place', pos: P(7, 6) },
      { type: 'place', pos: P(7, 5) },
      { type: 'swap', swap: false },
      { type: 'place', pos: P(7, 4) },
    )
    expect(kansei.meta.openingId).toBe('d1')
    expect(offersEquivalent(kansei.moves, P(6, 7), P(8, 7))).toBe(true)
    expectError(kansei, { type: 'offer', a: P(6, 7), b: P(8, 7) }, /對稱等價/)
    // 不等價的兩點 OK
    const ok = apply(kansei, { type: 'offer', a: P(6, 7), b: P(8, 8) })
    expect(rifPhase(ok)).toBe('choose5')
  })

  const offered = apply(at4, { type: 'offer', a: P(6, 8), b: P(9, 9) })

  it('擇打必須取兩打之一；成立後進正常輪替', () => {
    expectError(offered, { type: 'choose', pos: P(5, 5) }, /擇一/)
    const chosen = apply(offered, { type: 'choose', pos: P(9, 9) })
    expect(rifPhase(chosen)).toBe('normal')
    expect(chosen.moves.length).toBe(5)
    expect(chosen.moves[4]).toEqual(P(9, 9))
    // 之後正常落子
    const s6 = apply(chosen, { type: 'place', pos: P(11, 11) })
    expect(s6.moves.length).toBe(6)
    // 棄點 (6,8) 仍是空點，之後可以正常落子
    const s7 = apply(s6, { type: 'place', pos: P(6, 8) })
    expect(s7.moves.length).toBe(7)
  })
})

describe('record v2：round-trip 與嚴格拒絕', () => {
  const full = apply(
    rifInitial(),
    ...HOGETSU.map((pos) => ({ type: 'place', pos }) as const),
    { type: 'swap', swap: false },
    { type: 'place', pos: P(9, 6) },
    { type: 'offer', a: P(6, 8), b: P(9, 9) },
    { type: 'choose', pos: P(6, 8) },
    { type: 'place', pos: P(11, 11) },
  )

  it('serialize → parse → rifStateFromRecord 完整還原（含中途存檔）', () => {
    for (const s of [
      full,
      rifInitial(),
      apply(rifInitial(), ...HOGETSU.map((pos) => ({ type: 'place', pos }) as const)),
      apply(
        rifInitial(),
        ...HOGETSU.map((pos) => ({ type: 'place', pos }) as const),
        { type: 'swap', swap: true },
      ),
    ]) {
      const str = serializeRecord(rifRecord(s))
      const rec = parseRecord(str)
      expect(rec).not.toBeNull()
      const back = rifStateFromRecord(rec!)
      expect(back).not.toBeNull()
      expect(back!.moves).toEqual(s.moves)
      expect(back!.meta).toEqual(s.meta)
      // 再序列化一致（canonical）
      expect(serializeRecord(rifRecord(back!))).toBe(str)
    }
  })

  it('v2 具體字串格式', () => {
    expect(serializeRecord(rifRecord(full))).toBe('r2:hhigiijggill:oi7s0tgijj')
  })

  it('v1 解析不受影響（迴歸）', () => {
    const rec = parseRecord('r1:hhhgii')
    expect(rec).not.toBeNull()
    expect(rec!.rif).toBeUndefined()
    expect(rec!.moves.length).toBe(3)
    expect(serializeRecord(rec!)).toBe('r1:hhhgii')
  })

  it('結構性拒絕：事件與手數不相依/重複落子/空事件串', () => {
    expect(parseRecord('r2:hhigii')).toBeNull() // 3 手缺 o
    expect(parseRecord('r2:hhig:oi7')).toBeNull() // 2 手卻帶 o
    expect(parseRecord('r2:hhigiijg:oi7')).toBeNull() // 4 手缺 s
    expect(parseRecord('r2:hhigii:oi7s0thhii')).toBeNull() // 3 手卻帶 t
    expect(parseRecord('r2:hhigiijg:oi7s0thhii')).toBeNull() // 兩打占已有棋子點
    expect(parseRecord('r2:hhigiijggi:oi7s0tjjmm')).toBeNull() // 第 5 手不在兩打
    expect(parseRecord('r2:hhhh')).toBeNull() // 重複落子
    expect(parseRecord('r2:hhig:')).toBeNull() // 空事件串
    expect(parseRecord('r2:hhigiijggi:oi7s0tgigi')).toBeNull() // 兩打同點
  })

  it('語意性拒絕（rifStateFromRecord）：開局 id 與手順不符', () => {
    const rec = parseRecord('r2:hhigii:od4s0') // 手順是浦月(i7)，卻宣稱花月(d4)
    expect(rec).not.toBeNull()
    expect(rifStateFromRecord(rec!)).toBeNull()
    const good = parseRecord('r2:hhigii:oi7s0')
    expect(rifStateFromRecord(good!)).not.toBeNull()
  })

  it('語意性拒絕：對稱等價的兩打', () => {
    // 寒星＋白4 h11（中線對稱）＋等價兩打 (6,7)/(8,7)
    const rec = parseRecord('r2:hhhghfhe:od1s0tghih')
    expect(rec).not.toBeNull()
    expect(rifStateFromRecord(rec!)).toBeNull()
  })
})
