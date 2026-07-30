// RIF 正式規約狀態機（renju.net/rifrules 查證，2026-07）：
//   1. 暫黑擺前三手：第 1 手天元、第 2 手中央 3×3、第 3 手中央 5×5
//      ——即 26 珠型之一（合法性用 8 對稱歸一與 openings 資料比對）。
//   2. 暫白決定是否換邊（換邊＝暫白改執黑）。
//   3. 確定白方下第 4 手（任意空點）。
//   4. 黑方提出兩個第 5 手候選；官方原文要求兩點「unequal in all respects」
//      ——對稱等價的兩點視同一點，禁止（用盤面 canonical key 檢查）。
//   5. 白方擇一成立第 5 手，之後正常輪替。
//
// 純函式 reducer：不改 Game 類；盤面重放/勝負判定仍由 UI 層的 Game useMemo
// 負責（Study.tsx sim 手法先例）。moves 為單一真相，meta 只記規約事件，
// phase 由（meta, moves.length）推導——不存第二份可漂移的狀態。
import { BLACK, WHITE, SIZE, idx, opponent, type Color, type Pos } from '../engine/types.ts'
import { canonicalBoardKey } from '../engine/symmetry.ts'
import { findOpeningByMoves, getOpening } from '../content/openings.ts'
import type { GameRecord } from '../engine/record.ts'

export interface RifMeta {
  openingId: string | null
  swapped: boolean | null
  /** 黑方兩打候選（A、B 依提出順序；成立後保留，棄點可由 moves[4] 反推）。 */
  offers: [Pos, Pos] | null
}

export interface RifState {
  moves: Pos[]
  meta: RifMeta
}

export type RifPhase =
  | 'opening' // 暫黑擺前三手
  | 'swap' // 暫白決定換邊
  | 'move4' // 確定白方第 4 手（任意空點）
  | 'offer5' // 黑方提出兩個第 5 手候選
  | 'choose5' // 白方擇一
  | 'normal' // 正常輪替

export type RifAction =
  | { type: 'place'; pos: Pos } // opening / move4 / normal 的落子
  | { type: 'swap'; swap: boolean }
  | { type: 'offer'; a: Pos; b: Pos }
  | { type: 'choose'; pos: Pos }

export const RIF_CENTER: Pos = { x: 7, y: 7 }

export const emptyMeta = (): RifMeta => ({ openingId: null, swapped: null, offers: null })
export const rifInitial = (): RifState => ({ moves: [], meta: emptyMeta() })

export function rifPhase(s: RifState): RifPhase {
  const n = s.moves.length
  if (n < 3) return 'opening'
  if (n === 3) return s.meta.swapped === null ? 'swap' : 'move4'
  if (n === 4) return s.meta.offers === null ? 'offer5' : 'choose5'
  return 'normal'
}

/** 暫定執色 + 換邊決定 → 最終執色（換邊＝雙方互換）。 */
export function finalColor(tentative: Color, swapped: boolean | null): Color {
  return swapped ? opponent(tentative) : tentative
}

const same = (a: Pos, b: Pos): boolean => a.x === b.x && a.y === b.y
const cheb = (a: Pos, b: Pos): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))
const inBoard = (p: Pos): boolean => p.x >= 0 && p.x < SIZE && p.y >= 0 && p.y < SIZE
const occupied = (moves: readonly Pos[], p: Pos): boolean => moves.some((m) => same(m, p))

/** moves（依手順黑白輪替）＋額外一枚 color 子 → 盤面 canonical key。 */
function boardKeyWith(moves: readonly Pos[], extra: Pos | null, color: Color): string {
  const b = new Uint8Array(SIZE * SIZE)
  moves.forEach((m, i) => {
    b[idx(m.x, m.y)] = i % 2 === 0 ? BLACK : WHITE
  })
  if (extra) b[idx(extra.x, extra.y)] = color
  return canonicalBoardKey(b)
}

/** 兩個第 5 手候選是否對稱等價（等價＝視同只提一點，官方規則禁止）。 */
export function offersEquivalent(moves4: readonly Pos[], a: Pos, b: Pos): boolean {
  return boardKeyWith(moves4, a, BLACK) === boardKeyWith(moves4, b, BLACK)
}

/** 純函式 reducer：非法動作回原 state＋錯誤訊息（給 UI 顯示）。 */
export function rifReduce(s: RifState, action: RifAction): { next: RifState; error: string | null } {
  const err = (error: string) => ({ next: s, error })
  const phase = rifPhase(s)

  switch (action.type) {
    case 'place': {
      const p = action.pos
      if (!inBoard(p)) return err('落子在盤外')
      if (occupied(s.moves, p)) return err('該點已有棋子')
      if (phase === 'opening') {
        const n = s.moves.length
        if (n === 0 && !same(p, RIF_CENTER)) return err('規約第 1 手必須下在天元（H8）')
        if (n === 1 && cheb(p, RIF_CENTER) !== 1) return err('規約第 2 手須在天元周圍 3×3 內')
        if (n === 2) {
          if (cheb(p, RIF_CENTER) > 2) return err('規約第 3 手須在中央 5×5 內')
          const o = findOpeningByMoves([...s.moves, p])
          if (!o) return err('前三手不構成 26 種合法開局珠型')
          return {
            next: { moves: [...s.moves, p], meta: { ...s.meta, openingId: o.id } },
            error: null,
          }
        }
        return { next: { ...s, moves: [...s.moves, p] }, error: null }
      }
      if (phase === 'move4' || phase === 'normal') {
        return { next: { ...s, moves: [...s.moves, p] }, error: null }
      }
      return err('現在不是落子階段')
    }
    case 'swap': {
      if (phase !== 'swap') return err('現在不是換邊決定階段')
      return { next: { ...s, meta: { ...s.meta, swapped: action.swap } }, error: null }
    }
    case 'offer': {
      if (phase !== 'offer5') return err('現在不是黑方兩打階段')
      const { a, b } = action
      if (!inBoard(a) || !inBoard(b)) return err('兩打候選在盤外')
      if (same(a, b)) return err('兩打必須是兩個不同的點')
      if (occupied(s.moves, a) || occupied(s.moves, b)) return err('兩打候選不可落在已有棋子的點')
      if (offersEquivalent(s.moves, a, b))
        return err('兩打兩點對稱等價（等於只提示一點），規約不允許')
      return { next: { ...s, meta: { ...s.meta, offers: [a, b] } }, error: null }
    }
    case 'choose': {
      if (phase !== 'choose5') return err('現在不是白方擇打階段')
      const off = s.meta.offers!
      if (!off.some((p) => same(p, action.pos))) return err('第 5 手必須從兩打候選中擇一')
      return { next: { ...s, moves: [...s.moves, action.pos] }, error: null }
    }
  }
}

/** 規約狀態 → 棋譜（record v2）。 */
export function rifRecord(s: RifState): GameRecord {
  return {
    rule: 'renju',
    moves: [...s.moves],
    rif: {
      ...(s.meta.openingId ? { openingId: s.meta.openingId } : {}),
      ...(s.meta.swapped !== null ? { swapped: s.meta.swapped } : {}),
      ...(s.meta.offers ? { offers: s.meta.offers } : {}),
    },
  }
}

/** 棋譜（record v2）→ 規約狀態，含深度驗證：把整個規約流程用 reducer 重放，
 *  任一步不合法（開局型不符、兩打等價、第 5 手不在兩打…）回 null。
 *  分享連結/測試 hook 載入前必經此驗證。 */
export function rifStateFromRecord(rec: GameRecord): RifState | null {
  if (!rec.rif || rec.rule !== 'renju') return null
  const { moves } = rec
  const ev = rec.rif
  if (ev.openingId && !getOpening(ev.openingId)) return null

  let st = rifInitial()
  const apply = (a: RifAction): boolean => {
    const { next, error } = rifReduce(st, a)
    if (error) return false
    st = next
    return true
  }
  for (let i = 0; i < Math.min(3, moves.length); i++)
    if (!apply({ type: 'place', pos: moves[i] })) return null
  if (ev.swapped !== undefined && !apply({ type: 'swap', swap: ev.swapped })) return null
  if (moves.length >= 4 && !apply({ type: 'place', pos: moves[3] })) return null
  if (ev.offers && !apply({ type: 'offer', a: ev.offers[0], b: ev.offers[1] })) return null
  if (moves.length >= 5 && !apply({ type: 'choose', pos: moves[4] })) return null
  for (let i = 5; i < moves.length; i++)
    if (!apply({ type: 'place', pos: moves[i] })) return null

  // 事件與棋譜宣稱必須完全一致（openingId 由重放推得，防竄改）。
  if ((ev.openingId ?? null) !== st.meta.openingId) return null
  return st
}
