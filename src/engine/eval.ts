// 評估函數：棋型計數啟發式。只用於 AI 搜索的葉節點打分與走子排序；
// 「規則正確性」（勝負/禁手/VCF）一律走 rules.ts / forbidden.ts / vcf.ts 的精確判定，
// 這裡的近似不影響規則結果，只影響棋力。
//
// 作法：對 4 個方向的每條線滑動 5 格窗與 6 格窗計數：
//   - 5 格窗（無對方子）：己方 4 子=四、3 子=三、2 子=二（衝/眠不細分，重複窗自然加權）
//   - 6 格窗 .XXXX. → 活四；兩端空、中間 4 格含 3 子 → 活三近似
// 分數 = 己方棋型加權和 − 對方加權和（對方略放大：先擋為上）。
import { SIZE, EMPTY, idx, opponent, type Color } from './types.ts'
import type { Board } from './board.ts'

export const WIN_SCORE = 1_000_000_000

const W_FIVE = 10_000_000
const W_STRAIGHT_FOUR = 1_000_000
const W_FOUR = 20_000
const W_OPEN_THREE = 15_000
const W_THREE = 400
const W_TWO = 40

// 預先展開所有線（row/col/兩對角，長度 >=5），存 cell index 序列。
const LINES: number[][] = (() => {
  const lines: number[][] = []
  for (let y = 0; y < SIZE; y++) lines.push(Array.from({ length: SIZE }, (_, x) => idx(x, y)))
  for (let x = 0; x < SIZE; x++) lines.push(Array.from({ length: SIZE }, (_, y) => idx(x, y)))
  for (let s = -(SIZE - 5); s <= SIZE - 5; s++) {
    const d1: number[] = []
    const d2: number[] = []
    for (let y = 0; y < SIZE; y++) {
      const x1 = y + s
      if (x1 >= 0 && x1 < SIZE) d1.push(idx(x1, y))
      const x2 = SIZE - 1 - y + s
      if (x2 >= 0 && x2 < SIZE) d2.push(idx(x2, y))
    }
    if (d1.length >= 5) lines.push(d1)
    if (d2.length >= 5) lines.push(d2)
  }
  return lines
})()

function scoreColor(b: Board, color: Color): number {
  let score = 0
  for (const line of LINES) {
    const n = line.length
    // 5 格窗
    for (let i = 0; i + 5 <= n; i++) {
      let mine = 0
      let foe = 0
      for (let k = 0; k < 5; k++) {
        const v = b[line[i + k]]
        if (v === color) mine++
        else if (v !== EMPTY) foe++
      }
      if (foe > 0 || mine === 0) continue
      if (mine === 5) score += W_FIVE
      else if (mine === 4) score += W_FOUR
      else if (mine === 3) score += W_THREE
      else if (mine === 2) score += W_TWO
    }
    // 6 格窗：活四 / 活三近似
    for (let i = 0; i + 6 <= n; i++) {
      let mine = 0
      let foe = 0
      for (let k = 0; k < 6; k++) {
        const v = b[line[i + k]]
        if (v === color) mine++
        else if (v !== EMPTY) foe++
      }
      if (foe > 0) continue
      const endsEmpty = b[line[i]] === EMPTY && b[line[i + 5]] === EMPTY
      if (!endsEmpty) continue
      if (mine === 4) score += W_STRAIGHT_FOUR // .XXXX.
      else if (mine === 3) score += W_OPEN_THREE // .XXX.. / .X.XX. 等
    }
  }
  return score
}

/** 以 color 視角評估盤面（正分 = color 有利）。 */
export function evaluate(b: Board, color: Color): number {
  const mine = scoreColor(b, color)
  const theirs = scoreColor(b, opponent(color))
  return mine - Math.round(theirs * 1.05)
}

/** 走子排序用的局部打分：假設 color 下在 (x,y)，攻擊價值 + 防守價值。 */
export function scoreMoveLocal(b: Board, x: number, y: number, color: Color): number {
  const foe = opponent(color)
  return localGain(b, x, y, color) + Math.round(localGain(b, x, y, foe) * 0.9)
}

function localGain(b: Board, x: number, y: number, color: Color): number {
  // 只看經過 (x,y) 的 4 條線各 9 格範圍的 5 格窗。
  let gain = 0
  const dirs = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ] as const
  for (const [dx, dy] of dirs) {
    for (let s = -4; s <= 0; s++) {
      let mine = 1 // (x,y) 假設為己子
      let foe = 0
      let ok = true
      for (let k = 0; k < 5; k++) {
        const t = s + k
        if (t === 0) continue
        const cx = x + t * dx
        const cy = y + t * dy
        if (cx < 0 || cx >= SIZE || cy < 0 || cy >= SIZE) {
          ok = false
          break
        }
        const v = b[idx(cx, cy)]
        if (v === color) mine++
        else if (v !== EMPTY) foe++
      }
      if (!ok || foe > 0) continue
      if (mine >= 5) gain += W_FIVE
      else if (mine === 4) gain += W_FOUR
      else if (mine === 3) gain += W_THREE
      else if (mine === 2) gain += W_TWO
    }
  }
  return gain
}
