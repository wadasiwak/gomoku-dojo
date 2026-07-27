// 評估函數：棋型計數啟發式。只用於 AI 搜索的葉節點打分與走子排序；
// 「規則正確性」（勝負/禁手/VCF）一律走 rules.ts / forbidden.ts / vcf.ts 的精確判定，
// 這裡的近似不影響規則結果，只影響棋力。
//
// 作法：對 4 個方向的每條線滑動 5 格窗與 6 格窗計數：
//   - 5 格窗（無對方子）：己方 4 子=四、3 子=三、2 子=二（衝/眠不細分，重複窗自然加權）
//   - 6 格窗 .XXXX. → 活四；兩端空、中間 4 格含 3 子 → 活三近似
// 分數 = 己方棋型加權和 − 對方加權和（對方略放大：先擋為上）。
//
// 衝四價值校正（國手回饋：AI 習慣性亂衝四）：
//   衝四逼對方擋一手＝「幫對手多一顆棋子且消耗自己的資源」，除非衝完換到
//   更多實質，否則不該衝。故 W_FOUR（單成五點的四）必須低於 W_OPEN_THREE：
//   盤上一個「即將被擋」的四，其價值不得高於一個活三的發展價值——否則搜索
//   會在視野邊緣偏好無意義衝四（被擋後歸零的交換反而評高分）。
//   被擋死的四（窗內有對方子）本來就不計分；連珠黑棋「補空成長連」的死四型
//   （無有效成五點）由 exactFive 檢查歸零，見 scoreColor。
import { SIZE, EMPTY, BLACK, idx, opponent, type Color, type Rule } from './types.ts'
import type { Board } from './board.ts'

export const WIN_SCORE = 1_000_000_000

const W_FIVE = 10_000_000
const W_STRAIGHT_FOUR = 1_000_000
const W_FOUR = 6_000
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

/** exactFive（連珠黑）：四/活四的成五點補上後必須是「恰好五連」——
 *  窗外緊鄰若是己方子，補完成 >=6 長連＝無效成五點，該四型是死四，不計分。 */
function scoreColor(b: Board, color: Color, exactFive: boolean): number {
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
      else if (mine === 4) {
        // 死四歸零：補空後緊鄰窗外有己子 → 長連，對連珠黑無效。
        if (exactFive) {
          if (i > 0 && b[line[i - 1]] === color) continue
          if (i + 5 < n && b[line[i + 5]] === color) continue
        }
        score += W_FOUR
      } else if (mine === 3) score += W_THREE
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
      if (mine === 4) {
        // 連珠黑：窗外緊鄰有己子時，該側成五點是長連＝無效 → 非真活四
        // （降級為衝四，由 5 格窗的另一側計 W_FOUR），不給活四分。
        if (exactFive) {
          if (i > 0 && b[line[i - 1]] === color) continue
          if (i + 6 < n && b[line[i + 6]] === color) continue
        }
        score += W_STRAIGHT_FOUR // .XXXX.
      } else if (mine === 3) score += W_OPEN_THREE // .XXX.. / .X.XX. 等
    }
  }
  return score
}

/** 以 color 視角評估盤面（正分 = color 有利）。rule 用於連珠黑的死四歸零。 */
export function evaluate(b: Board, color: Color, rule: Rule): number {
  const mine = scoreColor(b, color, rule === 'renju' && color === BLACK)
  const theirs = scoreColor(b, opponent(color), rule === 'renju' && color !== BLACK)
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
