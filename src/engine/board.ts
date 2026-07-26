// 棋盤資料結構與基本操作。刻意保持極簡：一維 Uint8Array + 邊界安全存取。
import {
  SIZE,
  CELLS,
  EMPTY,
  WALL,
  idx,
  inBoard,
  type Cell,
  type Color,
} from './types.ts'

export type Board = Uint8Array // 長度 225；值為 EMPTY/BLACK/WHITE

export const createBoard = (): Board => new Uint8Array(CELLS)

export const cloneBoard = (b: Board): Board => new Uint8Array(b)

/** 邊界安全讀取：盤外回 WALL（掃描棋型時牆等同「被擋」）。 */
export const at = (b: Board, x: number, y: number): Cell | typeof WALL =>
  inBoard(x, y) ? (b[idx(x, y)] as Cell) : WALL

export const get = (b: Board, x: number, y: number): Cell => b[idx(x, y)] as Cell

export const set = (b: Board, x: number, y: number, v: Cell): void => {
  b[idx(x, y)] = v
}

export const isEmptyAt = (b: Board, x: number, y: number): boolean =>
  inBoard(x, y) && b[idx(x, y)] === EMPTY

/** 沿方向 (dx,dy) 從 (x,y) 的「下一格」起算，連續同色棋子數。 */
export function countRun(
  b: Board,
  x: number,
  y: number,
  dx: number,
  dy: number,
  color: Color,
): number {
  let n = 0
  let cx = x + dx
  let cy = y + dy
  while (at(b, cx, cy) === color) {
    n++
    cx += dx
    cy += dy
  }
  return n
}

/** 含 (x,y) 本身（假設該格為 color）、沿 ±(dx,dy) 的最大連續長度。 */
export function lineLenThrough(
  b: Board,
  x: number,
  y: number,
  dx: number,
  dy: number,
  color: Color,
): number {
  return 1 + countRun(b, x, y, dx, dy, color) + countRun(b, x, y, -dx, -dy, color)
}

export function boardIsFull(b: Board): boolean {
  for (let i = 0; i < CELLS; i++) if (b[i] === EMPTY) return false
  return true
}

/** 除錯用：棋盤轉 ASCII（X=黑、O=白、.=空）。 */
export function boardToString(b: Board): string {
  const rows: string[] = []
  for (let y = 0; y < SIZE; y++) {
    let row = ''
    for (let x = 0; x < SIZE; x++) {
      const v = get(b, x, y)
      row += v === EMPTY ? '.' : v === 1 ? 'X' : 'O'
    }
    rows.push(row)
  }
  return rows.join('\n')
}
