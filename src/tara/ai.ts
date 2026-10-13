// 塔拉山口-10 的 AI 開局決策（Rapfi 當評估器）。
//
// 決策只依賴 Oracle 介面——瀏覽器接 RapfiClient（src/tara/oracle.ts），
// node 腳本直接接 WASM glue（scripts/tara-ai-sim.mjs）——兩邊跑同一套邏輯。
//
// 各決策的想法（分數一律「黑方視角」，正＝黑優）：
//   - 擺第 2～5 手（下完對方可以交換）：擺得太好對方就換走 → 取「最均衡」的點：
//     候選逐一短評，取 |分數| 最小者，差距 BALANCE_BAND 內隨機挑（局局不同）。
//   - 交換：評估目前局面，自己執的顏色吃虧就換。
//   - 白 4 後的分支：先算十子值＝「黑擺最強 10 個不等價點、白挑對黑最差那個」
//     的分數；十子值 > 0（黑擺十子仍有利）→ 十子，否則走塔拉（之後還能交換、
//     第 5 手也會擺成均衡）。
//   - 擺十子：多 PV 取最強的 10 個兩兩不等價點。
//   - 擇一（白方）：10 點各短評，挑對黑最差的。
import { BLACK, SIZE, idx, type Color, type Pos } from '../engine/types.ts'
import { canonicalBoardKey } from '../engine/symmetry.ts'
import {
  TARA_CENTER,
  TARA_OFFER_COUNT,
  areaLimit,
  colorToMove,
  type TaraState,
} from './protocol.ts'

/** 評估器介面（分數皆為「該局面待下方」視角，呼叫端自行換成黑方視角）。 */
export interface Oracle {
  /** 單一局面評分（待下方視角）；引擎沒給分（秒殺/定式）回 null。 */
  evaluate(moves: readonly Pos[], timeMs: number): Promise<number | null>
  /** 多 PV：最多 n 個候選手＋各自分數（待下方視角），依引擎排序。 */
  nbest(moves: readonly Pos[], n: number, timeMs: number): Promise<{ move: Pos; score: number | null }[]>
}

/** 進度回報（UI 顯示「AI 評估候選 k/N」）。 */
export type Progress = (done: number, total: number) => void

/** 均衡帶：|分數| 與最小值差在此內的候選都算「一樣均衡」，隨機挑一。 */
const BALANCE_BAND = 40
/** 擺子均衡掃描：每個候選的評估時間。 */
export const SCAN_MS = 300
/** 交換決定的評估時間。 */
export const SWAP_MS = 1500
/** 十子多 PV：要比 10 多一些，扣掉對稱等價的還夠。 */
const TEN_NBEST = 16
export const TEN_MS = 4000
/** 白方擇一：每個候選的評估時間。 */
export const CHOOSE_MS = 700

const cheb = (a: Pos, b: Pos): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))

/** 待下方視角分數 → 黑方視角。 */
const toBlack = (score: number, moverAfter: Color): number => (moverAfter === BLACK ? score : -score)

/** 手順盤面＋（可選）一顆 color 子 → canonical key。 */
function boardKey(moves: readonly Pos[], extra?: Pos): string {
  const b = new Uint8Array(SIZE * SIZE)
  moves.forEach((m, i) => {
    b[idx(m.x, m.y)] = i % 2 === 0 ? 1 : 2
  })
  if (extra) b[idx(extra.x, extra.y)] = moves.length % 2 === 0 ? 1 : 2
  return canonicalBoardKey(b)
}

/** 下一手的候選格：範圍限制內、空點、距既有棋子 ≤2，並以對稱歸一去重
 *  （等價點評估結果必相同，只留一個代表）。 */
export function placementCandidates(moves: readonly Pos[], limit: number | null): Pos[] {
  const out: Pos[] = []
  const seen = new Set<string>()
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const p = { x, y }
      if (limit !== null && cheb(p, TARA_CENTER) > limit) continue
      if (moves.some((m) => m.x === x && m.y === y)) continue
      if (moves.length > 0 && !moves.some((m) => cheb(m, p) <= 2)) continue
      const k = boardKey(moves, p)
      if (seen.has(k)) continue
      seen.add(k)
      out.push(p)
    }
  return out
}

/** 在候選中依分數挑：先取 |分數| 最小，均衡帶內隨機。 */
function pickBalanced(scored: { move: Pos; black: number }[], rng: () => number): { move: Pos; black: number } {
  const best = Math.min(...scored.map((s) => Math.abs(s.black)))
  const pool = scored.filter((s) => Math.abs(s.black) <= best + BALANCE_BAND)
  return pool[Math.floor(rng() * pool.length)]
}

/** AI 擺第 2～5 手（下完對方可交換）：取最均衡的點。第 1 手固定天元。 */
export async function aiPlaceBalanced(
  s: TaraState,
  oracle: Oracle,
  rng: () => number = Math.random,
  onProgress?: Progress,
): Promise<{ move: Pos; black: number | null }> {
  const n = s.moves.length
  if (n === 0) return { move: TARA_CENTER, black: null }
  const cands = placementCandidates(s.moves, areaLimit(s, n + 1))
  const scored: { move: Pos; black: number }[] = []
  for (let i = 0; i < cands.length; i++) {
    onProgress?.(i, cands.length)
    const after = [...s.moves, cands[i]]
    const sc = await oracle.evaluate(after, SCAN_MS)
    if (sc !== null) scored.push({ move: cands[i], black: toBlack(sc, colorToMove(after)) })
  }
  onProgress?.(cands.length, cands.length)
  if (scored.length === 0) return { move: cands[Math.floor(rng() * cands.length)], black: null }
  return pickBalanced(scored, rng)
}

/** AI 交換決定：myColor＝AI 目前執的顏色；換了會比較好才換。 */
export async function aiSwap(
  s: TaraState,
  myColor: Color,
  oracle: Oracle,
): Promise<{ swap: boolean; black: number | null }> {
  const sc = await oracle.evaluate(s.moves, SWAP_MS)
  if (sc === null) return { swap: false, black: null }
  const black = toBlack(sc, colorToMove(s.moves))
  const mine = myColor === BLACK ? black : -black
  return { swap: mine < 0, black }
}

export interface TenPlan {
  /** 兩兩不等價的 10 個第 5 手（依引擎排序）。 */
  offers: Pos[]
  /** 十子值：白挑對黑最差那點後的黑方分數。 */
  value: number | null
}

/** 黑方的十子計畫：多 PV 取最強 10 個兩兩不等價點；多 PV 不足時用鄰近空點補齊。 */
export async function aiTenPlan(s: TaraState, oracle: Oracle): Promise<TenPlan> {
  const lines = await oracle.nbest(s.moves, TEN_NBEST, TEN_MS)
  const offers: Pos[] = []
  const scores: number[] = []
  const keys = new Set<string>()
  const take = (p: Pos, score: number | null) => {
    if (offers.length >= TARA_OFFER_COUNT) return
    if (s.moves.some((m) => m.x === p.x && m.y === p.y)) return
    const k = boardKey(s.moves, p)
    if (keys.has(k)) return
    keys.add(k)
    offers.push(p)
    if (score !== null) scores.push(score) // 黑待下 → 已是黑方視角
  }
  for (const l of lines) take(l.move, l.score)
  // 補齊：引擎給的 PV 不夠 10 個不等價點時（罕見），用鄰近空點湊滿（分數未知不計入十子值）
  if (offers.length < TARA_OFFER_COUNT)
    for (const p of placementCandidates(s.moves, null)) take(p, null)
  const value = scores.length === offers.length && scores.length > 0 ? Math.min(...scores) : null
  return { offers, value }
}

/** 白 4 後的分支決定（AI 為當時執黑者）。十子值 > 0 → 十子。 */
export function decideBranch(plan: TenPlan): 'tara' | 'ten' {
  return plan.value !== null && plan.value > 0 ? 'ten' : 'tara'
}

/** 白方擇一：十個候選各評，挑對黑最差的。 */
export async function aiChooseOffer(
  s: TaraState,
  oracle: Oracle,
  onProgress?: Progress,
): Promise<{ move: Pos; black: number | null; all: { move: Pos; black: number | null }[] }> {
  const offers = s.meta.offers!
  const all: { move: Pos; black: number | null }[] = []
  for (let i = 0; i < offers.length; i++) {
    onProgress?.(i, offers.length)
    const after = [...s.moves, offers[i]] // 落黑 5 → 白待下
    const sc = await oracle.evaluate(after, CHOOSE_MS)
    all.push({ move: offers[i], black: sc === null ? null : -sc })
  }
  onProgress?.(offers.length, offers.length)
  const known = all.filter((a): a is { move: Pos; black: number } => a.black !== null)
  if (known.length === 0) return { move: offers[0], black: null, all }
  const pick = known.reduce((a, b) => (b.black < a.black ? b : a))
  return { move: pick.move, black: pick.black, all }
}
