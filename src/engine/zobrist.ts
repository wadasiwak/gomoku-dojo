// Zobrist hash：置換表用。64-bit 以兩個 32-bit 整數表示（JS number 精度安全）。
// 亂數表用固定 seed 的 mulberry32 產生 → 跨執行環境（主執行緒/Worker/測試）一致。
import { CELLS, BLACK, type Color } from './types.ts'
import type { Board } from './board.ts'

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return (t ^ (t >>> 14)) >>> 0
  }
}

const rand = mulberry32(0x5f375a86)
// [color-1][cell] → {hi, lo}
const TABLE_HI: Uint32Array[] = [new Uint32Array(CELLS), new Uint32Array(CELLS)]
const TABLE_LO: Uint32Array[] = [new Uint32Array(CELLS), new Uint32Array(CELLS)]
for (let c = 0; c < 2; c++) {
  for (let i = 0; i < CELLS; i++) {
    TABLE_HI[c][i] = rand()
    TABLE_LO[c][i] = rand()
  }
}

export interface Hash {
  hi: number
  lo: number
}

export const emptyHash = (): Hash => ({ hi: 0, lo: 0 })

/** XOR 進/出一顆子（進出同一手互為反運算）。 */
export function xorStone(h: Hash, cell: number, color: Color): void {
  const c = color === BLACK ? 0 : 1
  h.hi = (h.hi ^ TABLE_HI[c][cell]) >>> 0
  h.lo = (h.lo ^ TABLE_LO[c][cell]) >>> 0
}

/** 由整個盤面重算（驗證增量一致性用）。 */
export function hashBoard(b: Board): Hash {
  const h = emptyHash()
  for (let i = 0; i < CELLS; i++) {
    const v = b[i]
    if (v === 1 || v === 2) xorStone(h, i, v as Color)
  }
  return h
}

/** 置換表 key：取 hi 低 21 bit 與 lo 合成 53-bit 整數（Map key 用），
 *  完整 hi 另存 entry 內做碰撞驗證。 */
export const hashKey = (h: Hash): number => (h.hi & 0x1fffff) * 0x100000000 + h.lo
