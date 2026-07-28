// 走子生成：鄰域候選 + 局部威脅打分排序 + 寬度截斷。
// renju 模式下黑棋的禁手點直接濾除（AI 執黑迴避禁手）；
// 若鄰域候選全是禁手，退而掃全盤找任一合法點（黑棋仍須落子）。
import { SIZE, CELLS, EMPTY, BLACK, idx, type Color, type Pos, type Rule } from './types.ts'
import type { Board } from './board.ts'
import { scoreMoveLocal } from './eval.ts'
import { isForbiddenMove } from './forbidden.ts'

export interface ScoredMove extends Pos {
  score: number
}

/** 產生候選著手（已排序、截斷至 width）。盤面全空時回中央一點。 */
export function generateMoves(
  b: Board,
  color: Color,
  rule: Rule,
  width: number,
): ScoredMove[] {
  const filterForbidden = rule === 'renju' && color === BLACK
  let hasStone = false
  const near = new Uint8Array(CELLS)
  for (let i = 0; i < CELLS; i++) {
    if (b[i] === EMPTY) continue
    hasStone = true
    const x = i % SIZE
    const y = Math.floor(i / SIZE)
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || nx >= SIZE || ny < 0 || ny >= SIZE) continue
        const ni = idx(nx, ny)
        if (b[ni] === EMPTY) near[ni] = 1
      }
    }
  }
  if (!hasStone) {
    const c = Math.floor(SIZE / 2)
    return [{ x: c, y: c, score: 0 }]
  }
  const moves: ScoredMove[] = []
  for (let i = 0; i < CELLS; i++) {
    if (!near[i]) continue
    const x = i % SIZE
    const y = Math.floor(i / SIZE)
    moves.push({ x, y, score: scoreMoveLocal(b, x, y, color) })
  }
  moves.sort((a, z) => z.score - a.score)
  if (filterForbidden) {
    // 禁手掃描貴（含三三/四四的遞迴棋型判定），先排序、由高分往下收滿
    // width 即停——只掃「會被留下」附近的候選，結果與先濾後截等價。
    const kept: ScoredMove[] = []
    for (const m of moves) {
      if (kept.length >= width) break
      if (isForbiddenMove(b, m.x, m.y).forbidden) continue
      kept.push(m)
    }
    moves.length = 0
    moves.push(...kept)
  } else if (moves.length > width) {
    moves.length = width
  }
  if (moves.length === 0 && filterForbidden) {
    // 鄰域全禁手：全盤找任一合法空點（極罕見）。
    for (let i = 0; i < CELLS; i++) {
      if (b[i] !== EMPTY) continue
      const x = i % SIZE
      const y = Math.floor(i / SIZE)
      if (!isForbiddenMove(b, x, y).forbidden) return [{ x, y, score: 0 }]
    }
  }
  return moves
}
