// 連珠（renju）黑棋禁手判定。本專案技術風險最高的模組，實作嚴格依 RIF 定義：
//
//   - 長連：一手使黑棋任一線最大連續長度 >= 6 → 禁手。
//   - 四四：一手同時形成兩個以上「不同 4 子集合」的四 → 禁手。
//     含同線跳四情形（如 X.XXX.X 補中、XX.XX.XX 補中，一子成同線兩個四）。
//     注意活四（straight four）也是「一個四」：活四 + 另一個四 = 四四禁手。
//     連四從左右兩窗找到的是同一個四（同 4 子集合），不重複計數。
//   - 三三：一手同時形成兩個以上「真活三」→ 禁手。
//     活三 = 存在至少一個延伸點 E，於 E 落黑子可成「活四」，且 E 本身
//     不是黑的禁手點（遞迴判定；若某三的所有延伸點都是禁手，該三是假活三）。
//   - 五連豁免：一手同時形成「恰好五連」與任何禁手形 → 黑勝，不是禁手。
//   - 判定理由優先序：五連 > 長連 > 四四 > 三三（一手同時長連與四四時判長連）。
//
// 遞迴終止：每層遞迴都在盤上多放一顆假想黑子，空點單調減少，必然終止。
// 另設深度保險絲 MAX_RECURSION（實戰遞迴深度極少超過 3–4 層）；深度耗盡時
// 保守地把該三視為活三（回到「不看遞迴的樸素三三」判定）。
//
// 已知理論極限：RIF 對「甲點是否禁手互相依賴」的悖論局面另有官方裁定條款，
// 純遞迴實作在那類人造局面可能與官方裁定不同；實戰不會出現。
import {
  BLACK,
  DIRS,
  EMPTY,
  idx,
  inBoard,
  posOf,
  type ForbiddenResult,
} from './types.ts'
import { at, type Board } from './board.ts'
import { makesExactFive, makesOverline } from './rules.ts'
import { findFoursThrough } from './threats.ts'

const MAX_RECURSION = 12

export interface Three {
  /** 組成三的 3 顆子（board index，排序後）。 */
  stones: number[]
  /** 可把此三變成活四的延伸點（board index）。 */
  extensions: number[]
  /** 方向索引（DIRS 下標）。 */
  dir: number
}

/** 找出「經過 (x,y)」的所有三（不含活性判定）。前提：(x,y) 已是黑子。
 *  三 = 存在空點 E（同線），於 E 落黑後出現一個同時含 (x,y) 與 E 的活四。
 *  以 3 子集合去重；同一個三的多個延伸點合併。 */
export function findThreesThrough(b: Board, x: number, y: number): Three[] {
  const self = idx(x, y)
  const found = new Map<string, Three>()
  for (let d = 0; d < DIRS.length; d++) {
    const [dx, dy] = DIRS[d]
    for (let t = -4; t <= 4; t++) {
      if (t === 0) continue
      const ex = x + t * dx
      const ey = y + t * dy
      if (!inBoard(ex, ey)) continue
      const e = idx(ex, ey)
      if (b[e] !== EMPTY) continue
      b[e] = BLACK
      const fours = findFoursThrough(b, x, y, BLACK, true)
      b[e] = EMPTY
      for (const f of fours) {
        if (f.dir !== d) continue
        if (f.completions.length < 2) continue // 必須成「活四」
        if (!f.stones.includes(e) || !f.stones.includes(self)) continue
        const stones = f.stones.filter((s) => s !== e)
        const key = d + ':' + stones.join(',')
        const existing = found.get(key)
        if (existing) {
          if (!existing.extensions.includes(e)) existing.extensions.push(e)
        } else {
          found.set(key, { stones, extensions: [e], dir: d })
        }
      }
    }
  }
  return [...found.values()]
}

function isForbiddenInner(b: Board, x: number, y: number, depth: number): ForbiddenResult {
  const i = idx(x, y)
  b[i] = BLACK
  try {
    // 五連豁免：同手成恰好五連（任一線）即勝，凌駕所有禁手。
    if (makesExactFive(b, x, y, BLACK)) return { forbidden: false }
    if (makesOverline(b, x, y, BLACK)) return { forbidden: true, kind: 'overline' }
    const fours = findFoursThrough(b, x, y, BLACK, true)
    if (fours.length >= 2) return { forbidden: true, kind: 'double-four' }
    const threes = findThreesThrough(b, x, y)
    if (threes.length >= 2) {
      let open = 0
      for (const three of threes) {
        let isOpen: boolean
        if (depth <= 0) {
          isOpen = true // 深度保險絲：退回樸素判定（見檔頭說明）
        } else {
          isOpen = three.extensions.some((e) => {
            const p = posOf(e)
            return !isForbiddenInner(b, p.x, p.y, depth - 1).forbidden
          })
        }
        if (isOpen) open++
        if (open >= 2) return { forbidden: true, kind: 'double-three' }
      }
    }
    return { forbidden: false }
  } finally {
    b[i] = EMPTY
  }
}

/** 判定黑棋落在空點 (x,y) 是否禁手（renju 模式專用；白棋無禁手）。
 *  前提：(x,y) 是空點。函式內部會暫放假想子、離開前還原，不改動盤面。 */
export function isForbiddenMove(b: Board, x: number, y: number): ForbiddenResult {
  if (!inBoard(x, y) || b[idx(x, y)] !== EMPTY) return { forbidden: false }
  if (!hasBlackNearby(b, x, y)) return { forbidden: false } // 快篩：附近無黑子不可能成形
  return isForbiddenInner(b, x, y, MAX_RECURSION)
}

/** 快篩：四線 8 個射線方向 4 格內是否有黑子（禁手形至少需要同線近距黑子）。 */
function hasBlackNearby(b: Board, x: number, y: number): boolean {
  for (const [dx, dy] of DIRS) {
    for (let t = -4; t <= 4; t++) {
      if (t === 0) continue
      if (at(b, x + t * dx, y + t * dy) === BLACK) return true
    }
  }
  return false
}

/** 全盤掃描目前所有黑棋禁手點（debug 頁與 UI 標記用）。回傳 board index 陣列。 */
export function findForbiddenPoints(b: Board): { index: number; kind: string }[] {
  const out: { index: number; kind: string }[] = []
  for (let y = 0; y < 15; y++) {
    for (let x = 0; x < 15; x++) {
      if (b[idx(x, y)] !== EMPTY) continue
      const r = isForbiddenMove(b, x, y)
      if (r.forbidden) out.push({ index: idx(x, y), kind: r.kind! })
    }
  }
  return out
}
