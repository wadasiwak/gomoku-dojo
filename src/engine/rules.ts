// 勝負判定核心。
//
// 定義（連珠 renju）：
//   - 黑：恰好五連（該線最大連續長度 == 5）才算勝；>=6 是長連禁手。
//   - 白：>=5（含長連）即勝。
// 定義（gomoku free-style）：黑白皆 >=5 即勝。
import { DIRS, BLACK, type Color, type Rule } from './types.ts'
import { lineLenThrough, type Board } from './board.ts'

/** (x,y) 已是 color 的前提下，該子是否構成「恰好五連」（任一方向最大連續長度==5）。 */
export function makesExactFive(b: Board, x: number, y: number, color: Color): boolean {
  for (const [dx, dy] of DIRS) {
    if (lineLenThrough(b, x, y, dx, dy, color) === 5) return true
  }
  return false
}

/** (x,y) 已是 color 的前提下，是否構成 >=5 連（含長連）。 */
export function makesFiveOrMore(b: Board, x: number, y: number, color: Color): boolean {
  for (const [dx, dy] of DIRS) {
    if (lineLenThrough(b, x, y, dx, dy, color) >= 5) return true
  }
  return false
}

/** (x,y) 已是 color 的前提下，是否構成長連（>=6）。 */
export function makesOverline(b: Board, x: number, y: number, color: Color): boolean {
  for (const [dx, dy] of DIRS) {
    if (lineLenThrough(b, x, y, dx, dy, color) >= 6) return true
  }
  return false
}

/** 依規則模式判斷剛下在 (x,y) 的 color 是否成勝（不含禁手判負，那在 game 層）。
 *
 *  renju 黑棋注意：長連不算勝，但「同一手同時形成恰好五連（另一線）與長連」
 *  時，五連優先、黑勝（五連豁免）。makesExactFive 逐方向獨立判定，天然滿足。 */
export function isWinningMove(
  b: Board,
  x: number,
  y: number,
  color: Color,
  rule: Rule,
): boolean {
  if (rule === 'renju' && color === BLACK) return makesExactFive(b, x, y, color)
  return makesFiveOrMore(b, x, y, color)
}
