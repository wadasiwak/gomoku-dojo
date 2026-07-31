// 防守模式的「比快」正確性迴歸（獨立檔：長同步搜索與其他測試分開，
// 避免 vitest worker RPC 心跳被餓死的假警報）。
import { describe, it, expect } from 'vitest'
import { BLACK, WHITE } from '../types.ts'
import { search, LEVELS } from '../search.ts'

describe('防守過濾：活四不是無條件「快過對手」', () => {
  it('對手有一手成五點時必擋不送終（2026-07-31 國手實戰迴歸）', () => {
    // 白 14 手時黑 G5-J8 衝四（五點 F4）且另有深層 VCF。舊防守過濾把
    // 「活四/雙四」無條件視為快過對手 → 白 F9 活四存活、正解 F4 被剔除。
    // 修正後全難度應下 F4（最頑強抵抗）。
    // 1 H8, 2 F10, 3 H6, 4 E9, 5 I7, 6 F8, 7 J8, 8 K9, 9 H7, 10 H9, 11 J6, 12 G9, 13 G5
    const ms: Array<[number, number]> = [
      [7, 7], [5, 5], [7, 9], [4, 6], [8, 8], [5, 7], [9, 7], [10, 6],
      [7, 8], [7, 6], [9, 9], [6, 6], [6, 10],
    ]
    const b = new Uint8Array(225)
    ms.forEach(([x, y], i) => {
      b[y * 15 + x] = i % 2 === 0 ? BLACK : WHITE
    })
    for (const lv of [2, 3, 4] as const) {
      const r = search(Uint8Array.from(b), WHITE, { rule: 'renju', ...LEVELS[lv] })
      // F4 = (5, 11)
      expect(r.move, `L${lv} 應擋 F4`).toEqual({ x: 5, y: 11 })
    }
  }, 30000)
})
