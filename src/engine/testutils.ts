// 測試/除錯用：從多行 ASCII 字串建盤。
//
// 格式：每行一列（由上而下 = y 0..），每格一字元（可用空白分隔）：
//   .  空點        X  黑子        O  白子
//   *  待測點（必須恰好一個或零個；為空點，回傳其座標）
// 行數/行寬可少於 15：不足處補空點，錨定在左上角。要測邊界效應時，
// 請刻意把棋型排在字串的邊緣列/行（即棋盤邊線）。
import { EMPTY, BLACK, WHITE, SIZE, idx, type Pos } from './types.ts'
import { createBoard, set, type Board } from './board.ts'

/** 由「列字母＋行數字」棋譜串建盤（如 'H8 I9 G9'；奇數手黑、偶數手白）。
 *  列字母 A..O → x=0..14；行數字 → 內部 y = 15 - row（由上而下）。 */
export function boardOfMoves(game: string): Board {
  const b = createBoard()
  game.split(' ').forEach((s, i) => {
    const x = s.charCodeAt(0) - 65
    const y = 15 - parseInt(s.slice(1), 10)
    b[idx(x, y)] = i % 2 === 0 ? BLACK : WHITE
  })
  return b
}

export interface ParsedBoard {
  board: Board
  /** '*' 的座標（沒有 '*' 時為 null）。 */
  star: Pos | null
}

export function parseBoard(text: string): ParsedBoard {
  const lines = text
    .split('\n')
    .map((l) => l.replace(/\s+/g, ''))
    .filter((l) => l.length > 0)
  if (lines.length > SIZE) throw new Error(`盤面超過 ${SIZE} 列`)
  const board = createBoard()
  let star: Pos | null = null
  for (let y = 0; y < lines.length; y++) {
    const line = lines[y]
    if (line.length > SIZE) throw new Error(`第 ${y} 列超過 ${SIZE} 格: ${line}`)
    for (let x = 0; x < line.length; x++) {
      const ch = line[x]
      if (ch === '.') continue
      if (ch === 'X') set(board, x, y, BLACK)
      else if (ch === 'O') set(board, x, y, WHITE)
      else if (ch === '*') {
        if (star) throw new Error('盤面有多個 *')
        star = { x, y }
        set(board, x, y, EMPTY)
      } else throw new Error(`未知字元 '${ch}'`)
    }
  }
  return { board, star }
}
