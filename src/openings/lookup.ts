// 開局書查表核心（純函式、不 import book.json——generator 產書途中也要用同一套
// 邏輯走主變化，抽成獨立模組讓 scripts 與 UI 共用，對稱處理只此一份）。
//
// key 設計：canonicalMovesKey（手順 8 對稱歸一取字典序最小）。查表時找出
// 「把實際手順映成 canonical key」的那個對稱 t，命中後把書中建議手（存的是
// canonical 方位）用 t⁻¹ **反變換**回實際盤方位——這是最容易錯的點：
// key 字串逐手相等保證 t 把實際局面「逐手」映上書局面，故 t⁻¹(書手) 在實際
// 盤面上與書手完全同構；若局面本身有對稱（多個 t 並列最小），任一 t 的反變換
// 互為對稱像、等價合法（vitest 8 方位全覆蓋釘住這件事）。
import { SYMMETRIES } from '../engine/symmetry.ts'
import { SIZE, type Pos } from '../engine/types.ts'

/** SYMMETRIES[i] 的逆變換 index（前 6 個自逆；旋轉 90°/270° 互逆）。 */
export const INVERSE_SYMMETRY: readonly number[] = [0, 1, 2, 3, 4, 5, 7, 6]

/** 書中一筆：move 為 canonical 方位的 2 字元著手（'a'..'o' 各表 0..14）。 */
export interface BookEntry {
  move: string
  /** 行棋方視角評分（Rapfi cp；±29000 以上＝必勝/必敗殺）。 */
  score: number
  /** 產生該筆時 Rapfi 報的搜索深度。 */
  depth: number
}

export interface BookHit {
  /** 已反變換回實際盤方位的建議手。 */
  move: Pos
  score: number
  depth: number
}

const A = 'a'.charCodeAt(0)

export const moveToStr = (p: Pos): string =>
  String.fromCharCode(A + p.x) + String.fromCharCode(A + p.y)

export const strToMove = (s: string): Pos => ({
  x: s.charCodeAt(0) - A,
  y: s.charCodeAt(1) - A,
})

/** 手順在對稱 t 下的著手串（與 canonicalMovesKey 內部同一編碼）。 */
function transformedKey(moves: readonly Pos[], t: (x: number, y: number) => Pos): string {
  let s = ''
  for (const m of moves) {
    const p = t(m.x, m.y)
    s += String.fromCharCode(A + p.x) + String.fromCharCode(A + p.y)
  }
  return s
}

/** 在任意 entries map 中查手順：命中回（已反變換的）建議手＋分數。
 *  多個對稱並列最小時取 index 最小的 t（結果等價，只求確定性）。 */
export function lookupIn(
  entries: Readonly<Record<string, BookEntry>>,
  moves: readonly Pos[],
): BookHit | null {
  let bestKey: string | null = null
  let bestT = 0
  for (let i = 0; i < SYMMETRIES.length; i++) {
    const s = transformedKey(moves, SYMMETRIES[i])
    if (bestKey === null || s < bestKey) {
      bestKey = s
      bestT = i
    }
  }
  const e = bestKey !== null ? entries[bestKey] : undefined
  if (!e) return null
  const c = strToMove(e.move)
  const p = SYMMETRIES[INVERSE_SYMMETRY[bestT]](c.x, c.y)
  // 防呆：建議手必須落在空點（key 相等已保證，此檢查擋壞資料）。
  if (moves.some((m) => m.x === p.x && m.y === p.y)) return null
  return { move: p, score: e.score, depth: e.depth }
}

/** 穩健線的分數等價帶（cp）：與最佳候選分差在此以內視為「分數接近」。 */
export const STABLE_MARGIN = 120

/**
 * 穩健線查表（L1-L3 開局用）：除了本局面的直接條目（最佳線），也枚舉
 * 「下完某手後的子局面」在書中的條目作為候選（子局面分數是對手視角，
 * 取負＝該手的行棋方視角價值）。與最佳候選分差 ≤ STABLE_MARGIN 的等價帶內
 * **偏好 |score| 最小的均衡線**——先前 L3 直接吃書的最佳線 4勝8敗（書力/
 * 搜索力錯配：書引入的尖銳局面淺搜跟不住），分數接近時選穩健線避開錯配；
 * 等價帶外仍取最佳（明顯較優的線不因求穩放棄）。
 * 平手 tie-break：depth 大者優先，再取 cell index 小者（確定性）。
 */
export function lookupStableIn(
  entries: Readonly<Record<string, BookEntry>>,
  moves: readonly Pos[],
): BookHit | null {
  const direct = lookupIn(entries, moves)
  // 候選＝鄰域（既有子 Chebyshev ≤2）空點中「子局面在書裡」的手；空盤只有直接條目。
  const pool = new Map<number, BookHit>()
  if (moves.length > 0) {
    const occupied = new Set(moves.map((m) => m.y * SIZE + m.x))
    const seen = new Set<number>()
    for (const s of moves) {
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const x = s.x + dx
          const y = s.y + dy
          if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) continue
          const cell = y * SIZE + x
          if (occupied.has(cell) || seen.has(cell)) continue
          seen.add(cell)
          const child = lookupIn(entries, [...moves, { x, y }])
          if (child) pool.set(cell, { move: { x, y }, score: -child.score, depth: child.depth })
        }
      }
    }
  }
  // 直接條目對「它自己的手」是更權威的分數（本局面深算），覆蓋子局面推導值。
  if (direct) pool.set(direct.move.y * SIZE + direct.move.x, direct)
  if (pool.size === 0) return null
  let best = -Infinity
  for (const c of pool.values()) if (c.score > best) best = c.score
  let picked: BookHit | null = null
  let pickedCell = -1
  for (const [cell, c] of pool) {
    if (c.score < best - STABLE_MARGIN) continue
    if (
      picked === null ||
      Math.abs(c.score) < Math.abs(picked.score) ||
      (Math.abs(c.score) === Math.abs(picked.score) &&
        (c.depth > picked.depth || (c.depth === picked.depth && cell < pickedCell)))
    ) {
      picked = c
      pickedCell = cell
    }
  }
  return picked
}
