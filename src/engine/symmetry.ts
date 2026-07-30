// 盤面 8 對稱（dihedral group D4：恆等/三種旋轉/四條鏡射軸）與正規化。
// 用途：26 開局珠型比對（rif/protocol）、規約兩打「完全不等價」檢查，
// 以及之後的開局書查表——介面設計成可對任意手順/盤面取 canonical form。
// 純函式、零依賴，可在 Web Worker 執行。
import { SIZE, type Pos } from './types.ts'

const N = SIZE - 1

/** D4 全部 8 個變換；天元 (7,7) 為不動點。 */
export const SYMMETRIES: ReadonlyArray<(x: number, y: number) => Pos> = [
  (x, y) => ({ x, y }), // 恆等
  (x, y) => ({ x: N - x, y }), // 左右鏡射
  (x, y) => ({ x, y: N - y }), // 上下鏡射
  (x, y) => ({ x: N - x, y: N - y }), // 旋轉 180°
  (x, y) => ({ x: y, y: x }), // 主對角鏡射（轉置）
  (x, y) => ({ x: N - y, y: N - x }), // 反對角鏡射
  (x, y) => ({ x: N - y, y: x }), // 旋轉 90°
  (x, y) => ({ x: y, y: N - x }), // 旋轉 270°
]

const A = 'a'.charCodeAt(0)

const movesStr = (moves: readonly Pos[]): string => {
  let s = ''
  for (const m of moves) s += String.fromCharCode(A + m.x) + String.fromCharCode(A + m.y)
  return s
}

/** 手順正規形 key：8 個對稱像的著手串取字典序最小。
 *  兩段手順 key 相同 ⇔ 存在某個對稱把其中一段逐手映成另一段（順序保留）。 */
export function canonicalMovesKey(moves: readonly Pos[]): string {
  let best: string | null = null
  for (const t of SYMMETRIES) {
    const s = movesStr(moves.map((m) => t(m.x, m.y)))
    if (best === null || s < best) best = s
  }
  return best ?? ''
}

/** 盤面正規形 key：8 個對稱像的盤面（row-major 值串）取字典序最小。
 *  與手順無關（只看石頭分佈）——開局書查表、兩打等價檢查用。 */
export function canonicalBoardKey(b: ArrayLike<number>): string {
  let best: string | null = null
  for (const t of SYMMETRIES) {
    let s = ''
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) {
        const p = t(x, y)
        s += b[p.y * SIZE + p.x]
      }
    if (best === null || s < best) best = s
  }
  return best ?? ''
}
