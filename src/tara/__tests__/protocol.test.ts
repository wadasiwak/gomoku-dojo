// 塔拉山口-10 reducer 全路徑：範圍限制／三次交換／兩種解讀的塔拉、十子分支／
// 十子等價檢查／誰有權行動（actorColor）與換色推導。
import { describe, expect, it } from 'vitest'
import {
  taraInitial,
  taraReduce,
  taraPhase,
  actorColor,
  firstPlayerColor,
  offerEquivalentTo,
  type TaraState,
  type TaraAction,
} from '../protocol.ts'
import { BLACK, WHITE, type Pos } from '../../engine/types.ts'

const P = (x: number, y: number): Pos => ({ x, y })

function apply(state: TaraState, ...actions: TaraAction[]): TaraState {
  let s = state
  for (const a of actions) {
    const { next, error } = taraReduce(s, a)
    expect(error, JSON.stringify(a)).toBeNull()
    s = next
  }
  return s
}

const expectError = (s: TaraState, a: TaraAction, pattern: RegExp) => {
  const { next, error } = taraReduce(s, a)
  expect(error).toMatch(pattern)
  expect(next).toBe(s)
}

const place = (x: number, y: number): TaraAction => ({ type: 'place', pos: P(x, y) })
const swap = (v: boolean): TaraAction => ({ type: 'swap', swap: v })

/** 前四手（不交換）：天元、H7 直接、I9（5×5 內）、F10（7×7 內）。 */
const FIRST_FOUR: TaraAction[] = [
  place(7, 7),
  swap(false),
  place(7, 8),
  swap(false),
  place(8, 6),
  swap(false),
  place(4, 4),
]

/** 十個兩兩不等價、空的候選（右下象限一排，盤面不對稱足以區分）。 */
const TEN = [
  P(10, 10), P(11, 10), P(12, 10), P(13, 10), P(10, 11),
  P(11, 11), P(12, 11), P(13, 11), P(10, 12), P(11, 12),
]

describe('taraReduce：範圍限制', () => {
  it('第 1 手只能天元', () => {
    expectError(taraInitial(), place(6, 7), /天元/)
    expect(taraPhase(apply(taraInitial(), place(7, 7)))).toBe('swap')
  })
  it('第 2/3/4 手分別限 3×3、5×5、7×7', () => {
    let s = apply(taraInitial(), place(7, 7), swap(false))
    expectError(s, place(9, 7), /3×3/)
    s = apply(s, place(8, 7), swap(false))
    expectError(s, place(10, 7), /5×5/)
    s = apply(s, place(9, 7), swap(false))
    expectError(s, place(11, 7), /7×7/)
    s = apply(s, place(10, 7))
    expect(s.moves).toHaveLength(4)
  })
  it('交換決定前不能落子、落子階段不能交換', () => {
    const s = apply(taraInitial(), place(7, 7))
    expectError(s, place(7, 8), /不是落子/)
    expectError(apply(s, swap(true)), swap(false), /不是交換/)
  })
})

describe('換色與行動者', () => {
  it('每次交換互換執色；行動者＝下一手顏色的持有者', () => {
    let s = apply(taraInitial(), place(7, 7))
    expect(actorColor(s)).toBe(WHITE) // 黑 1 後由白方決定交換
    s = apply(s, swap(true))
    expect(firstPlayerColor(s.meta)).toBe(WHITE) // 下黑 1 的人現在執白
    s = apply(s, place(7, 8))
    expect(actorColor(s)).toBe(BLACK) // 白 2 後由黑方決定
    s = apply(s, swap(true))
    expect(firstPlayerColor(s.meta)).toBe(BLACK)
  })
})

describe('standard 解讀（簡章寫法）', () => {
  it('白 4 之後先選分支；塔拉 → 交換 → 第 5 手限 9×9 → 交換 → 正常', () => {
    let s = apply(taraInitial('standard'), ...FIRST_FOUR)
    expect(taraPhase(s)).toBe('branch')
    expect(actorColor(s)).toBe(BLACK)
    s = apply(s, { type: 'branch', branch: 'tara' })
    expect(taraPhase(s)).toBe('swap')
    s = apply(s, swap(false))
    expect(taraPhase(s)).toBe('place')
    expectError(s, place(12, 12), /9×9/)
    s = apply(s, place(11, 11))
    expect(taraPhase(s)).toBe('swap')
    expect(actorColor(s)).toBe(WHITE)
    s = apply(s, swap(true))
    expect(taraPhase(s)).toBe('normal')
    expect(firstPlayerColor(s.meta)).toBe(WHITE)
    s = apply(s, place(0, 0)) // 第 6 手全盤任意
    expect(s.moves).toHaveLength(6)
  })
  it('十子：選了就沒有交換，黑擺十點、白擇一、白下第 6 手', () => {
    let s = apply(taraInitial('standard'), ...FIRST_FOUR, { type: 'branch', branch: 'ten' })
    expect(taraPhase(s)).toBe('offer10')
    expect(s.meta.swaps).toHaveLength(3)
    s = apply(s, { type: 'offer', offers: TEN })
    expect(taraPhase(s)).toBe('choose10')
    expect(actorColor(s)).toBe(WHITE)
    expectError(s, { type: 'choose', pos: P(0, 0) }, /十個候選/)
    s = apply(s, { type: 'choose', pos: P(12, 11) })
    expect(taraPhase(s)).toBe('normal')
    expect(s.moves[4]).toEqual(P(12, 11))
    s = apply(s, place(0, 14))
    expect(s.moves).toHaveLength(6)
  })
})

describe('swapFirst 解讀', () => {
  it('白 4 之後先交換，換完的執黑者再選分支', () => {
    let s = apply(taraInitial('swapFirst'), ...FIRST_FOUR)
    expect(taraPhase(s)).toBe('swap')
    s = apply(s, swap(true))
    expect(taraPhase(s)).toBe('branch')
    expect(firstPlayerColor(s.meta)).toBe(WHITE)
    s = apply(s, { type: 'branch', branch: 'ten' })
    expect(taraPhase(s)).toBe('offer10')
  })
  it('塔拉分支：第 5 手後再一次交換', () => {
    let s = apply(taraInitial('swapFirst'), ...FIRST_FOUR, swap(false), {
      type: 'branch',
      branch: 'tara',
    })
    expect(taraPhase(s)).toBe('place')
    s = apply(s, place(9, 9))
    expect(taraPhase(s)).toBe('swap')
    s = apply(s, swap(false))
    expect(taraPhase(s)).toBe('normal')
  })
})

describe('十子驗證', () => {
  const at = apply(taraInitial(), ...FIRST_FOUR, { type: 'branch', branch: 'ten' })
  it('數量必須剛好 10', () => {
    expectError(at, { type: 'offer', offers: TEN.slice(0, 9) }, /剛好擺 10/)
  })
  it('不可落在已有棋子、不可重複', () => {
    expectError(at, { type: 'offer', offers: [P(7, 7), ...TEN.slice(1)] }, /已有棋子/)
    expectError(at, { type: 'offer', offers: [TEN[1], ...TEN.slice(1)] }, /重複/)
  })
  it('對稱等價的兩點不可同時提出', () => {
    // 只有天元一顆黑子＋白 H7：盤面左右對稱 → G9 與 I9 等價
    const sym = [P(7, 7), P(7, 8)]
    expect(offerEquivalentTo(sym, [P(6, 6)], P(8, 6))).toEqual(P(6, 6))
    expect(offerEquivalentTo(sym, [P(6, 6)], P(6, 8))).toBeNull()
    // 前四手不對稱 → 同樣兩點不等價
    expect(offerEquivalentTo(at.moves, [P(6, 6)], P(8, 6))).toBeNull()
  })
})
