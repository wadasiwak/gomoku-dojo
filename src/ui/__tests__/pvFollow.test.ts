// Rapfi 建議路線「跟著走」判定：照路線下、偏離、悔棋回去、顏色不對。
import { describe, expect, it } from 'vitest'
import { pvProgress, remainingPv, type PvAnchor } from '../pvFollow.ts'
import { BLACK, WHITE, CELLS, idx, type Pos } from '../../engine/types.ts'

const P = (x: number, y: number): Pos => ({ x, y })

function boardWith(stones: [Pos, number][]): Uint8Array {
  const b = new Uint8Array(CELLS)
  for (const [p, c] of stones) b[idx(p.x, p.y)] = c
  return b
}

// 錨點：盤上黑 H8，輪白；主變化 I9（白）J10（黑）G7（白）
const root = boardWith([[P(7, 7), BLACK]])
const anchor: PvAnchor = { root, line: [P(8, 6), P(9, 5), P(6, 8)], color: WHITE, key: 'k' }

describe('pvProgress / remainingPv', () => {
  it('還沒下：k=0，整條路線都在', () => {
    expect(pvProgress(anchor, root)).toBe(0)
    expect(remainingPv(anchor, root).map((r) => r.color)).toEqual([WHITE, BLACK, WHITE])
  })
  it('照路線下了第一手：k=1，剩兩手且顏色接續', () => {
    const b = boardWith([[P(7, 7), BLACK], [P(8, 6), WHITE]])
    expect(pvProgress(anchor, b)).toBe(1)
    expect(remainingPv(anchor, b)).toEqual([
      { pos: P(9, 5), color: BLACK },
      { pos: P(6, 8), color: WHITE },
    ])
  })
  it('走了別的點：偏離 → null、路線收掉', () => {
    const b = boardWith([[P(7, 7), BLACK], [P(0, 0), WHITE]])
    expect(pvProgress(anchor, b)).toBeNull()
    expect(remainingPv(anchor, b)).toEqual([])
  })
  it('下在路線點但顏色不對：偏離', () => {
    const b = boardWith([[P(7, 7), BLACK], [P(8, 6), BLACK]])
    expect(pvProgress(anchor, b)).toBeNull()
  })
  it('跳著下（沒下第一手就下第二手）：偏離', () => {
    const b = boardWith([[P(7, 7), BLACK], [P(9, 5), BLACK]])
    expect(pvProgress(anchor, b)).toBeNull()
  })
  it('悔棋回到錨點盤面：整條路線恢復', () => {
    expect(remainingPv(anchor, Uint8Array.from(root))).toHaveLength(3)
  })
  it('拿掉錨點時的子（擺譜清除）：偏離', () => {
    expect(pvProgress(anchor, new Uint8Array(CELLS))).toBeNull()
  })
  it('整條走完：剩 0 手', () => {
    const b = boardWith([[P(7, 7), BLACK], [P(8, 6), WHITE], [P(9, 5), BLACK], [P(6, 8), WHITE]])
    expect(pvProgress(anchor, b)).toBe(3)
    expect(remainingPv(anchor, b)).toEqual([])
  })
})
