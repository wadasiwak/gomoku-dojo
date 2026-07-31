// 規約兩打（offer5）／擇打（choose5）的本站引擎回退決策（三層 fallback 鏈的第 3 層；
// 第 1 層開局書、第 2 層 Rapfi 即時分析在 UI 層編排，見 Play.tsx）。
//
// 為什麼不能用靜態 eval 決策（2026-07 國手實戰抓到的 bug）：名月＋白4 I10 局面，
// 靜態排序把 H7 排第 2 而提進兩打——Rapfi 15s 真值 H7＝−M19（黑被殺穿、白必勝），
// 而黑明明有必勝提打 G9（+M50，靜態僅第 6）。靜態 eval 分不出「小虧」與「被殺穿」。
//
// 回退決策改為「落子後對手最佳應」的淺搜評分＋VCF 安全篩：
//   1. 靜態 eval 只當排隊順序（挑進搜索池），不當決策分。
//   2. 每個候選：落子 → 解「對手 VCF」（預算同 Play.tsx 防守閘門）——對手有 VCF
//      的候選標記不安全，選對時剔除（全滅才允許帶回，UI 註記「無安全打點」）。
//   3. 淺搜評分：對手視角搜索、取負為己方視角。⚠️ 深度固定偶數且要在時限內
//      跑得完——不同候選若停在不同深度（奇偶不同），分數被「誰下最後一手」的
//      tempo 奇偶偏置主導、完全不可比（同 Play.tsx 換邊決策的教訓；實測本局面
//      depth 6 限時 1.5s 部分候選只完成 d5，H7 反而竄回第 2）。
//
// 誠實極限（實測，勿高估這層）：
//   - VCF 篩在開局階段（第 5 手）結構性無效——白才 2 子，連一個四都做不出來，
//     任何預算（實測至 maxDepth 24/10s）nodes=1 直接空手而回。它防的是中盤
//     「送對手現成殺」的候選，不是開局殺穿。
//   - H7 的敗因是白的深層 VCT/戰略勝（−M19），d4 淺搜把它排到後段（2888 vs
//     G9 17348）靠的是交換後盤面評估，不是算穿；同局面 F6 真值同樣是 −M17，
//     d4 淺搜卻排第 1——淺搜分不出「小虧」與「被殺穿」的病只減輕、沒根治。
// 這層只是「比靜態 eval 誠實一點」的保底，真值級決策靠第 2 層 Rapfi。
import { EMPTY, SIZE, idx, opponent, type Color, type Rule } from './types.ts'
import type { Board } from './board.ts'
import { evaluate } from './eval.ts'
import { search } from './search.ts'
import { solveVcf } from './vcf.ts'
import { canonicalBoardKey } from './symmetry.ts'

/** 空點且 Chebyshev 距離 ≤2 內有任一子 → 兩打候選格。 */
export function candidateCells(board: ArrayLike<number>): number[] {
  const out: number[] = []
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      if (board[idx(x, y)] !== EMPTY) continue
      let near = false
      for (let dy = -2; dy <= 2 && !near; dy++)
        for (let dx = -2; dx <= 2 && !near; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || nx >= SIZE || ny < 0 || ny >= SIZE) continue
          if (board[idx(nx, ny)] !== EMPTY) near = true
        }
      if (near) out.push(idx(x, y))
    }
  return out
}

export interface OfferScanOptions {
  /** 進搜索池的候選數上限（靜態預排序取前 N）。 */
  poolSize?: number
  /** 淺搜固定深度（偶數；見檔頭奇偶偏置註解）。 */
  searchDepth?: number
  /** 單一候選的淺搜時限上限（保險絲；正常在時限內跑完固定深度）。 */
  searchTimeMs?: number
}

export interface OfferCandidateScore {
  cell: number
  /** color 視角＝−（對手最佳應搜索分）；對手有 VCF 時＝−WIN_SCORE 級。 */
  score: number
  /** 淺搜實際完成深度（未達 searchDepth＝被時限截斷，分數與他人不可比）。 */
  depth: number
  /** 落子後對手在防守閘門預算內解得出 VCF ＝此候選會被殺穿。 */
  foeVcf: boolean
}

const DEFAULTS: Required<OfferScanOptions> = {
  poolSize: 12,
  searchDepth: 4,
  searchTimeMs: 1500,
}

/** 對手 VCF 檢查預算：同 Play.tsx AI 手番的防守閘門（foeHasVcf）。 */
const FOE_VCF_BUDGET = { maxDepth: 10, timeLimitMs: 500, maxNodes: 30_000 }

/**
 * 候選各做「落子後對手最佳應」淺搜評分＋對手 VCF 安全篩。
 * 回傳依（安全者優先、分數降冪、cell 升冪）排序。不改動傳入盤面。
 */
export function scanOfferCandidates(
  b: Board,
  color: Color,
  rule: Rule,
  cells: number[],
  opts: OfferScanOptions = {},
): OfferCandidateScore[] {
  const { poolSize, searchDepth, searchTimeMs } = { ...DEFAULTS, ...opts }
  const foe = opponent(color)
  // 靜態預排序：只決定誰進池，不當決策分。
  const pool = cells
    .map((cell) => {
      b[cell] = color
      const pre = evaluate(b, color, rule)
      b[cell] = EMPTY
      return { cell, pre }
    })
    .sort((a, z) => z.pre - a.pre || a.cell - z.cell)
    .slice(0, poolSize)

  const out: OfferCandidateScore[] = []
  for (const { cell } of pool) {
    b[cell] = color
    const v = solveVcf(b, foe, rule, FOE_VCF_BUDGET)
    if (v.found) {
      // 被殺穿：不再搜索（分數只用來在「全滅」時挑最不糟的——殺線越長越不糟）。
      out.push({ cell, score: -1_000_000 + v.line.length, depth: 0, foeVcf: true })
    } else {
      const r = search(b, foe, {
        rule,
        maxDepth: searchDepth,
        timeLimitMs: searchTimeMs,
        width: 10,
        vcfDepth: 6,
      })
      out.push({ cell, score: -r.score, depth: r.depth, foeVcf: false })
    }
    b[cell] = EMPTY
  }
  out.sort(
    (a, z) =>
      (a.foeVcf ? 1 : 0) - (z.foeVcf ? 1 : 0) || z.score - a.score || a.cell - z.cell,
  )
  return out
}

/** scored 中第一名＋第一個與其互不對稱等價者（RIF 規約：兩打兩點須完全不等價）。
 *  scored 依「好→壞」排序；等價判定＝各補一枚 color 子後盤面 canonical key 相同。 */
export function pickInequivalentPair<T extends { cell: number }>(
  board: ArrayLike<number>,
  color: Color,
  scored: readonly T[],
): { a: T; b: T } | null {
  const a = scored[0]
  if (!a) return null
  const keyWith = (cell: number): string => {
    const b = Uint8Array.from(board as ArrayLike<number>)
    b[cell] = color
    return canonicalBoardKey(b)
  }
  const aKey = keyWith(a.cell)
  for (let i = 1; i < scored.length; i++) {
    if (keyWith(scored[i].cell) !== aKey) return { a, b: scored[i] }
  }
  return null
}

export interface OfferSelection {
  a: OfferCandidateScore
  b: OfferCandidateScore
  /** 兩打中「落子後對手有 VCF」的點數（>0＝安全候選湊不滿，UI 要註記）。 */
  unsafeCount: number
}

/** 第 3 層的兩打選擇：安全候選（對手無 VCF）優先湊互不等價的一對；
 *  湊不滿才允許帶入不安全點（unsafeCount 讓 UI 誠實註記「無安全打點」）。 */
export function selectOfferPair(
  board: ArrayLike<number>,
  color: Color,
  scored: readonly OfferCandidateScore[],
): OfferSelection | null {
  const safe = scored.filter((s) => !s.foeVcf)
  const safePair = pickInequivalentPair(board, color, safe)
  if (safePair) return { ...safePair, unsafeCount: 0 }
  // 安全者不足（0 或 1 個、或全等價）：整池湊，數不安全點。
  const pair = pickInequivalentPair(board, color, scored)
  if (!pair) return null
  return {
    ...pair,
    unsafeCount: (pair.a.foeVcf ? 1 : 0) + (pair.b.foeVcf ? 1 : 0),
  }
}
