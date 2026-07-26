// 威脅棋型偵測：四（衝四/活四）。禁手判定與 VCF 搜索共用。
//
// 「四」的嚴格定義：一線上存在一個 5 連格窗，內含己方 4 子 + 1 空點，
// 且補上該空點即成「有效的五」：
//   - exact 模式（連珠黑棋）：補完必須是「恰好五連」——窗外兩端緊鄰格
//     都不可是己方子（否則補完成 >=6 長連，對黑無效，不算四）。
//   - 非 exact（白棋 / gomoku）：補完 >=5 即有效，不看窗外。
//
// 「活四（straight four）」：同一組 4 子有兩個不同的有效成五點。
// 依定義用「成五點數量」判別：活四 = completions.length >= 2。
// 注意四的「身分」以其 4 子集合認定（連四從左右兩個窗各找到一次，
// 是同一個四，須去重）——四四禁手數的是不同 4 子集合的個數。
import { DIRS, EMPTY, idx, inBoard, type Color } from './types.ts'
import { at, type Board } from './board.ts'

export interface Four {
  /** 組成這個四的 4 顆子（board index，排序後）。 */
  stones: number[]
  /** 有效成五點（board index）。長度 1=衝四、>=2=活四。 */
  completions: number[]
  /** 方向索引（DIRS 下標），除錯用。 */
  dir: number
}

/** 找出「經過 (x,y)」的所有四。前提：(x,y) 已是 color 的子。
 *  以 4 子集合去重；同一集合的多個成五點合併進 completions。 */
export function findFoursThrough(
  b: Board,
  x: number,
  y: number,
  color: Color,
  exact: boolean,
): Four[] {
  const found = new Map<string, Four>()
  for (let d = 0; d < DIRS.length; d++) {
    const [dx, dy] = DIRS[d]
    // 所有包含 (x,y) 的 5 格窗：起點偏移 s = -4..0
    for (let s = -4; s <= 0; s++) {
      const cells: number[] = []
      let ok = true
      for (let k = 0; k < 5; k++) {
        const cx = x + (s + k) * dx
        const cy = y + (s + k) * dy
        if (!inBoard(cx, cy)) {
          ok = false
          break
        }
        cells.push(idx(cx, cy))
      }
      if (!ok) continue
      let empties = 0
      let emptyIdx = -1
      let mine = 0
      for (const c of cells) {
        const v = b[c]
        if (v === color) mine++
        else if (v === EMPTY) {
          empties++
          emptyIdx = c
        }
      }
      if (mine !== 4 || empties !== 1) continue
      if (exact) {
        // 窗外兩端緊鄰格不可是己方子，否則補完成 >=6（黑棋長連，無效）。
        const beforeX = x + (s - 1) * dx
        const beforeY = y + (s - 1) * dy
        const afterX = x + (s + 5) * dx
        const afterY = y + (s + 5) * dy
        if (at(b, beforeX, beforeY) === color) continue
        if (at(b, afterX, afterY) === color) continue
      }
      const stones = cells.filter((c) => b[c] === color).sort((a, z) => a - z)
      const key = d + ':' + stones.join(',')
      const existing = found.get(key)
      if (existing) {
        if (!existing.completions.includes(emptyIdx)) existing.completions.push(emptyIdx)
      } else {
        found.set(key, { stones, completions: [emptyIdx], dir: d })
      }
    }
  }
  // 理論上同一 4 子集合只會屬於一個方向，但保險起見再以子集合去重一次。
  const bySet = new Map<string, Four>()
  for (const f of found.values()) {
    const key = f.stones.join(',')
    const existing = bySet.get(key)
    if (existing) {
      for (const c of f.completions)
        if (!existing.completions.includes(c)) existing.completions.push(c)
    } else {
      bySet.set(key, f)
    }
  }
  return [...bySet.values()]
}

/** (x,y) 已是 color 的子時，該子是否參與一個活四。 */
export function hasStraightFourThrough(
  b: Board,
  x: number,
  y: number,
  color: Color,
  exact: boolean,
): boolean {
  return findFoursThrough(b, x, y, color, exact).some((f) => f.completions.length >= 2)
}
