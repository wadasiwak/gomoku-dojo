// 五子棋道場 — 引擎共用型別。純 TS、零依賴，可在 Web Worker 執行。

/** 棋盤固定 15×15（連珠標準盤）。 */
export const SIZE = 15
export const CELLS = SIZE * SIZE

/** 格子狀態。WALL 是邊界外的虛擬值，讓棋型掃描把牆當作「被擋住」。 */
export const EMPTY = 0
export const BLACK = 1
export const WHITE = 2
export const WALL = 3

export type Color = typeof BLACK | typeof WHITE
export type Cell = typeof EMPTY | Color

/** 規則模式：
 *  - gomoku：無禁手（free-style），黑白任一方連成 ≥5 即勝（含長連）。
 *  - renju：連珠規則。黑方禁手（長連 >5、三三、四四），黑方恰好五連才算勝；
 *    白方無禁手且 ≥5（含長連）算勝。黑方落子踩禁手判負。
 */
export type Rule = 'gomoku' | 'renju'

export interface Pos {
  x: number // 0..14，左→右
  y: number // 0..14，上→下
}

export const opponent = (c: Color): Color => (c === BLACK ? WHITE : BLACK)

export const idx = (x: number, y: number): number => y * SIZE + x
export const posOf = (i: number): Pos => ({ x: i % SIZE, y: Math.floor(i / SIZE) })
export const inBoard = (x: number, y: number): boolean =>
  x >= 0 && x < SIZE && y >= 0 && y < SIZE

/** 四個掃描方向：橫、直、右下斜、右上斜。 */
export const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
]

/** 禁手原因。優先序（同一手同時成立多項時的判定理由）：
 *  五連豁免（不是禁手）> 長連 > 四四 > 三三。 */
export type ForbiddenKind = 'overline' | 'double-four' | 'double-three'

export interface ForbiddenResult {
  forbidden: boolean
  kind?: ForbiddenKind
}

/** 對局結果。 */
export type GameResult =
  | { kind: 'ongoing' }
  | { kind: 'win'; winner: Color; reason: 'five' | 'overline' | 'forbidden' | 'resign' }
  | { kind: 'draw' }
