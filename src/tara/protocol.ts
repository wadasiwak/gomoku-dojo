// 塔拉山口-10（Taraguchi-10）開局規則狀態機。
//
// 條文：台灣五子棋協會《第十八屆名人賽》簡章（2026-10），國手 2026-10-13 親自釐清：
//   1. 黑下第 1 手（天元）　　　　　　→ 對方可交換
//   2. 白下第 2 手（中央 3×3）　　　　→ 對方可交換
//   3. 黑下第 3 手（中央 5×5）　　　　→ 對方可交換
//   4. 白下第 4 手（中央 7×7）
//   白 4 下完後，對方（＝當時執黑者）三選一：
//     ① 十打：持黑擺 10 個第 5 手候選（全盤任意、兩兩不可對稱等價）→
//            對方擇一成立第 5 手 → 白下第 6 手（防對方下太奇怪的白 4）
//     ② 持黑：自己下黑 5（中央 9×9）→ 對方最後選黑白
//     ③ 持白：對方下黑 5（中央 9×9）→ 自己最後選黑白
//   ②③ 與第 1～4 手的塔拉交換同一個意思（＝白 4 後的交換點，再加黑 5 後的交換點）。
//
// 「交換」＝雙方互換執色；誰有權交換＝下一手輪到的那個顏色的持有者。
// ②③ 在 meta 裡記為 branch='tara' 加一個交換點（②＝不換、③＝換），
// 與第 1～3 手的交換點同一套推導，不另立狀態。
//
// 純函式 reducer，形狀比照 rif/protocol.ts：moves 為單一真相，meta 只記事件，
// phase 由（meta, moves.length）推導。盤面勝負仍由 UI 層 Game 重放判定。
import { t } from '../i18n/index.ts'
import { BLACK, WHITE, SIZE, idx, type Color, type Pos } from '../engine/types.ts'
import { canonicalBoardKey } from '../engine/symmetry.ts'

/** 十打的候選數。 */
export const TARA_OFFER_COUNT = 10

export interface TaraMeta {
  /** 每個交換點的決定，依發生順序（true＝交換）。 */
  swaps: boolean[]
  /** 白 4 之後的路線：tara＝②③（下黑 5）、ten＝①十打；尚未選＝null。 */
  branch: 'tara' | 'ten' | null
  /** 十打：黑方擺出的 10 個第 5 手候選。 */
  offers: Pos[] | null
}

export interface TaraState {
  moves: Pos[]
  meta: TaraMeta
}

export type TaraPhase =
  | 'place' // 落子（第 1–4 手、塔拉分支第 5 手、之後正常輪替）
  | 'swap' // 下一手的持有者決定是否交換
  | 'branch' // 白 4 之後三選一（十打／持黑／持白）
  | 'offer10' // 黑方擺 10 個第 5 手候選
  | 'choose10' // 白方擇一
  | 'normal' // 開局結束，正常輪替

export type TaraAction =
  | { type: 'place'; pos: Pos }
  | { type: 'swap'; swap: boolean }
  /** 白 4 後三選一：ten＝①十打、black＝②持黑下黑 5、white＝③持白讓對方下黑 5。 */
  | { type: 'branch'; choice: BranchChoice }
  | { type: 'offer'; offers: Pos[] }
  | { type: 'choose'; pos: Pos }

export type BranchChoice = 'ten' | 'black' | 'white'

export const TARA_CENTER: Pos = { x: 7, y: 7 }

export const taraInitial = (): TaraState => ({
  moves: [],
  meta: { swaps: [], branch: null, offers: null },
})

/** 第 n 手（1 起算）允許的範圍：與天元的 Chebyshev 距離上限。
 *  第 1 手 0（天元）、2 手 1（3×3）、3 手 2（5×5）、4 手 3（7×7）、塔拉第 5 手 4（9×9）。
 *  其餘（十打候選、第 6 手起）不限＝null。 */
export function areaLimit(state: TaraState, moveNo: number): number | null {
  if (moveNo <= 4) return moveNo - 1
  if (moveNo === 5 && state.meta.branch === 'tara') return 4
  return null
}

/** 範圍上限 → 「中央 N×N」的 N（UI 文案用）。 */
export const areaSize = (limit: number): number => limit * 2 + 1

export function taraPhase(s: TaraState): TaraPhase {
  const n = s.moves.length
  const { swaps, branch, offers } = s.meta
  if (n === 0) return 'place'
  if (n <= 3) return swaps.length < n ? 'swap' : 'place'
  if (n === 4) {
    if (branch === null) return 'branch'
    if (branch === 'tara') return 'place' // ②③ 已含白 4 後的交換點（swaps[3]）
    return offers === null ? 'offer10' : 'choose10'
  }
  if (n === 5 && branch === 'tara') {
    // 黑 5 之後的交換點（第 5 個：1、2、3、白 4 後、黑 5 後）＝「最後選黑白」
    return swaps.length < 5 ? 'swap' : 'normal'
  }
  return 'normal'
}

/** 交換次數為奇數 → 雙方執色互換。 */
export const colorsSwapped = (meta: TaraMeta): boolean =>
  meta.swaps.filter(Boolean).length % 2 === 1

/** 開局時拿黑（下第 1 手）的一方，目前實際執的顏色。 */
export function firstPlayerColor(meta: TaraMeta): Color {
  return colorsSwapped(meta) ? WHITE : BLACK
}

/** 下一手輪到的顏色（依手數推）。 */
export const colorToMove = (moves: readonly Pos[]): Color =>
  moves.length % 2 === 0 ? BLACK : WHITE

/** 目前該由哪個顏色的持有者行動：
 *  交換／分支決定＝下一手輪到的顏色；十打擺放＝黑；十打擇一＝白。 */
export function actorColor(s: TaraState): Color {
  const ph = taraPhase(s)
  if (ph === 'offer10') return BLACK
  if (ph === 'choose10') return WHITE
  return colorToMove(s.moves)
}

const same = (a: Pos, b: Pos): boolean => a.x === b.x && a.y === b.y
const cheb = (a: Pos, b: Pos): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))
const inBoard = (p: Pos): boolean => p.x >= 0 && p.x < SIZE && p.y >= 0 && p.y < SIZE
const occupied = (moves: readonly Pos[], p: Pos): boolean => moves.some((m) => same(m, p))

/** 手順盤面＋一顆黑子 extra → canonical key（十打對稱等價檢查用）。 */
function keyWithBlack(moves: readonly Pos[], extra: Pos): string {
  const b = new Uint8Array(SIZE * SIZE)
  moves.forEach((m, i) => {
    b[idx(m.x, m.y)] = i % 2 === 0 ? BLACK : WHITE
  })
  b[idx(extra.x, extra.y)] = BLACK
  return canonicalBoardKey(b)
}

/** 候選 p 是否與已選候選中某一點對稱等價（等價＝白方挑起來是同一局面）。 */
export function offerEquivalentTo(moves4: readonly Pos[], picked: readonly Pos[], p: Pos): Pos | null {
  const k = keyWithBlack(moves4, p)
  return picked.find((q) => keyWithBlack(moves4, q) === k) ?? null
}

export function taraReduce(
  s: TaraState,
  action: TaraAction,
): { next: TaraState; error: string | null } {
  const err = (error: string) => ({ next: s, error })
  const phase = taraPhase(s)
  const n = s.moves.length

  switch (action.type) {
    case 'place': {
      if (phase !== 'place' && phase !== 'normal') return err(t('現在不是落子階段'))
      const p = action.pos
      if (!inBoard(p)) return err(t('落子在盤外'))
      if (occupied(s.moves, p)) return err(t('該點已有棋子'))
      const limit = areaLimit(s, n + 1)
      if (limit !== null && cheb(p, TARA_CENTER) > limit)
        return err(
          limit === 0
            ? t('第 1 手必須下在天元（H8）')
            : t('第 {n} 手須在中央 {k}×{k} 範圍內', { n: n + 1, k: areaSize(limit) }),
        )
      return { next: { ...s, moves: [...s.moves, p] }, error: null }
    }
    case 'swap': {
      if (phase !== 'swap') return err(t('現在不是交換決定階段'))
      return { next: { ...s, meta: { ...s.meta, swaps: [...s.meta.swaps, action.swap] } }, error: null }
    }
    case 'branch': {
      if (phase !== 'branch') return err(t('現在不是白 4 後的選擇階段'))
      if (action.choice === 'ten')
        return { next: { ...s, meta: { ...s.meta, branch: 'ten' } }, error: null }
      // ②持黑＝不換、③持白＝換（下黑 5 的人＝換完的執黑者）
      const swap = action.choice === 'white'
      return {
        next: { ...s, meta: { ...s.meta, branch: 'tara', swaps: [...s.meta.swaps, swap] } },
        error: null,
      }
    }
    case 'offer': {
      if (phase !== 'offer10') return err(t('現在不是黑方十打的階段'))
      const offers = action.offers
      if (offers.length !== TARA_OFFER_COUNT) return err(t('必須剛好擺 {n} 個候選', { n: TARA_OFFER_COUNT }))
      for (let i = 0; i < offers.length; i++) {
        const p = offers[i]
        if (!inBoard(p)) return err(t('候選在盤外'))
        if (occupied(s.moves, p)) return err(t('候選不可落在已有棋子的點'))
        if (offers.slice(0, i).some((q) => same(q, p))) return err(t('候選不可重複'))
        const eq = offerEquivalentTo(s.moves, offers.slice(0, i), p)
        if (eq) return err(t('有兩個候選對稱等價（白方挑起來是同一局面），規則不允許'))
      }
      return { next: { ...s, meta: { ...s.meta, offers: [...offers] } }, error: null }
    }
    case 'choose': {
      if (phase !== 'choose10') return err(t('現在不是白方擇一的階段'))
      if (!s.meta.offers!.some((p) => same(p, action.pos))) return err(t('第 5 手必須從十個候選中擇一'))
      return { next: { ...s, moves: [...s.moves, action.pos] }, error: null }
    }
  }
}
