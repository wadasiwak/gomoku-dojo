// 規約兩打/擇打的引擎回退決策（三層鏈第 3 層）測試。
//
// 迴歸背景（2026-07 國手實戰 bug）：名月＋白4 I10 為書外局面，舊的靜態 evalMoves
// 決策提出 I8/H7 兩打——Rapfi 15s 真值（黑視角）H7＝−M19（白必勝），而黑有必勝
// 提打 G9（+M50，靜態排序僅第 6）。
//
// 誠實極限（實測校準，見 offer.ts 檔頭）：本站引擎在合理預算內「識別不了」
// H7 之劣——VCF 篩在第 5 手結構性無效（白才 2 子，任何預算 nodes=1 空手回），
// d4 淺搜把 H7 排到後段靠的是交換後盤面評估，不是算穿 −M19；同局面 F6
// （真值 −M17）淺搜反而排第 1。故斷言只釘實戰回報的迴歸點（兩打不含 H7、
// H7 排序低於 G9），不宣稱這層能把「被殺穿」全數擋掉——那是第 2 層 Rapfi 的事。
import { describe, expect, it } from 'vitest'
import { BLACK, WHITE, idx, posOf } from '../types.ts'
import { isForbiddenMove } from '../forbidden.ts'
import {
  candidateCells,
  pickInequivalentPair,
  scanOfferCandidates,
  selectOfferPair,
} from '../offer.ts'

const label = (cell: number): string => {
  const p = posOf(cell)
  return String.fromCharCode(65 + p.x) + (15 - p.y)
}

/** 名月（H8/I9/G6）＋白4 I10 的盤面（輪黑提兩打）。 */
function meigetsuI10(): Uint8Array {
  const moves = [
    { x: 7, y: 7 }, // 黑 H8
    { x: 8, y: 6 }, // 白 I9
    { x: 6, y: 9 }, // 黑 G6
    { x: 8, y: 5 }, // 白 I10
  ]
  const b = new Uint8Array(225)
  moves.forEach((m, i) => {
    b[idx(m.x, m.y)] = i % 2 === 0 ? BLACK : WHITE
  })
  return b
}

const H7 = idx(7, 8)
const G9 = idx(6, 6)

describe('candidateCells', () => {
  it('名月+I10：48 個近盤候選、不含已占點', () => {
    const b = meigetsuI10()
    const cells = candidateCells(b)
    expect(cells).toHaveLength(48)
    expect(cells).not.toContain(idx(7, 7))
    expect(cells).toContain(H7)
    expect(cells).toContain(G9)
  })
})

describe('scanOfferCandidates＋selectOfferPair（名月+I10 迴歸）', () => {
  it(
    '兩打不含 H7（−M19 敗著），且 H7 排序顯著低於 G9',
    () => {
      const b = meigetsuI10()
      const cells = candidateCells(b).filter((c) => {
        const p = posOf(c)
        return !isForbiddenMove(b, p.x, p.y).forbidden
      })
      const scan = scanOfferCandidates(b, BLACK, 'renju', cells)
      const sel = selectOfferPair(b, BLACK, scan)
      expect(sel).not.toBeNull()
      const pair = [sel!.a.cell, sel!.b.cell]
      // 迴歸核心：被殺穿的 H7 不得再進兩打
      expect(pair, `提出 ${pair.map(label).join('/')}`).not.toContain(H7)

      // 誠實斷言：H7 淺搜分顯著低於 G9（非「識別 −M19」——見檔頭）
      const h7 = scan.find((s) => s.cell === H7)
      const g9 = scan.find((s) => s.cell === G9)
      expect(h7).toBeDefined()
      expect(g9).toBeDefined()
      expect(h7!.score).toBeLessThan(g9!.score)
      // 盤面還原（scan 不留副作用）
      expect(b).toEqual(meigetsuI10())
    },
    60_000,
  )
})

describe('foeVcf 安全篩（機制驗證：對手一手成五＝最短 VCF）', () => {
  // 白 B8..E8 四連、A8 被黑堵死 → 白唯一成五點 F8。黑候選若不落 F8，
  // 白 VCF（一手成五）成立 → 該候選標不安全並被選對剔除。
  function fourBoard(): Uint8Array {
    const b = new Uint8Array(225)
    for (let x = 1; x <= 4; x++) b[idx(x, 7)] = WHITE
    b[idx(0, 7)] = BLACK
    // 補幾枚遠端子讓黑白子數自洽（不影響殺形）
    b[idx(12, 12)] = BLACK
    b[idx(12, 2)] = BLACK
    b[idx(2, 12)] = WHITE
    return b
  }

  it('不擋成五點的候選 foeVcf=true；擋點安全', () => {
    const b = fourBoard()
    const block = idx(5, 7) // F8：唯一擋點
    const far = idx(10, 10)
    const scan = scanOfferCandidates(b, BLACK, 'renju', [block, far])
    const rBlock = scan.find((s) => s.cell === block)!
    const rFar = scan.find((s) => s.cell === far)!
    expect(rBlock.foeVcf).toBe(false)
    expect(rFar.foeVcf).toBe(true)
    // 排序：安全者在前
    expect(scan[0].cell).toBe(block)
  })

  it('selectOfferPair：安全候選湊不滿一對時才帶入不安全點並計數', () => {
    const b = fourBoard()
    const scan = scanOfferCandidates(b, BLACK, 'renju', [idx(5, 7), idx(10, 10), idx(9, 3)])
    const sel = selectOfferPair(b, BLACK, scan)!
    expect(sel.a.cell).toBe(idx(5, 7)) // 唯一安全點居首
    expect(sel.unsafeCount).toBe(1) // 第二點只能帶不安全的
  })
})

describe('pickInequivalentPair', () => {
  it('對稱等價的次名被跳過（RIF：兩打不可等價）', () => {
    // 空盤只有中央一子：與它對稱的兩點等價 → 應跳到第一個不等價點
    const b = new Uint8Array(225)
    b[idx(7, 7)] = WHITE
    const scored = [
      { cell: idx(7, 5) }, // 天元正上 2
      { cell: idx(7, 9) }, // 正下 2：與上者對稱等價
      { cell: idx(6, 5) }, // 不等價
    ]
    const pair = pickInequivalentPair(b, BLACK, scored)
    expect(pair!.a.cell).toBe(idx(7, 5))
    expect(pair!.b.cell).toBe(idx(6, 5))
  })

  it('空清單/全等價回 null', () => {
    const b = new Uint8Array(225)
    b[idx(7, 7)] = WHITE
    expect(pickInequivalentPair(b, BLACK, [])).toBeNull()
    expect(
      pickInequivalentPair(b, BLACK, [{ cell: idx(7, 5) }, { cell: idx(5, 7) }]),
    ).toBeNull()
  })
})
