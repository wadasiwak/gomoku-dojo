// 題庫答題判定器：用引擎「即時驗證」判對錯，而不是死背唯一解線。
//
// 規約（VCF 題，用戶執攻方）：
//   - 攻方每一手必須「直接成五」或「成四」（衝四/活四），其餘一律判錯。
//   - 成四後若守方出現一手成五點 → 攻方讓了半拍，判錯（defender-five）。
//   - 衝四（唯一成五點 E）：守方最強應手就是擋 E（引擎代守方回擋），
//     擋完後引擎驗證「攻方仍存在 VCF」——仍在則判對、繼續；VCF 消失
//     （solveVcf 已證實無解）則判錯（loses-vcf）。
//   - 活四/雙四（成五點 ≥2）：守方單手擋不完，代守方擋「最像實戰」的一點
//     （能順便做出守方自己的四者優先），攻方下一手成五收官。
//   - renju：攻方黑棋踩禁手直接判錯；守方黑棋被迫擋的點若是禁手 → 擋不了，
//     攻方（白）勝（forced-forbidden，逼禁手正是白的勝著）。
//
// 判定器本身不改動傳入盤面；回擋的守方著手由呼叫端落子。
import {
  BLACK,
  EMPTY,
  opponent,
  posOf,
  type Color,
  type Pos,
  type Rule,
} from '../engine/types.ts'
import { cloneBoard, set, type Board } from '../engine/board.ts'
import { isWinningMove } from '../engine/rules.ts'
import { isForbiddenMove } from '../engine/forbidden.ts'
import { findFoursThrough } from '../engine/threats.ts'
import { findFivePoints, type VcfResult } from '../engine/vcf.ts'

export type WrongReason = 'forbidden' | 'not-four' | 'defender-five' | 'loses-vcf'

export type Verdict =
  /** 這一手直接成五（勝）或把守方逼進禁手點（守方擋不了）——題目完成。 */
  | { kind: 'solved'; how: 'five' | 'forced-forbidden' }
  /** 判對：守方已被引擎代為最強回擋（reply），輪攻方繼續。 */
  | { kind: 'continue'; reply: Pos }
  /** 判錯：這一手不成立，呼叫端應撤回並提示可重試/看解答。 */
  | { kind: 'wrong'; reason: WrongReason }

/** VCF 求解器（UI 端注入 worker 版、測試注入同步版）。 */
export type VcfSolver = (
  b: Board,
  attacker: Color,
  rule: Rule,
) => Promise<VcfResult> | VcfResult

/** 判定攻方在 board 上走 move 是否為正確的 VCF 續著。不改動 board。 */
export async function judgeAttackerMove(
  board: Board,
  attacker: Color,
  rule: Rule,
  move: Pos,
  solve: VcfSolver,
): Promise<Verdict> {
  const defender = opponent(attacker)
  const exact = rule === 'renju' && attacker === BLACK
  const b = cloneBoard(board)

  if (exact && isForbiddenMove(b, move.x, move.y).forbidden) {
    return { kind: 'wrong', reason: 'forbidden' }
  }
  set(b, move.x, move.y, attacker)

  if (isWinningMove(b, move.x, move.y, attacker, rule)) {
    return { kind: 'solved', how: 'five' }
  }

  const fours = findFoursThrough(b, move.x, move.y, attacker, exact)
  if (fours.length === 0) return { kind: 'wrong', reason: 'not-four' }

  // 成四但守方有成五點：守方不理你的四、直接成五（五 > 四）→ 判錯。
  if (findFivePoints(b, defender, rule).length > 0) {
    return { kind: 'wrong', reason: 'defender-five' }
  }

  const completions = new Set<number>()
  for (const f of fours) for (const c of f.completions) completions.add(c)

  // 守方擋不進禁手點（renju 守方為黑時）。
  const blockable = [...completions].filter((c) => {
    if (rule !== 'renju' || defender !== BLACK) return true
    const p = posOf(c)
    return !isForbiddenMove(b, p.x, p.y).forbidden
  })
  if (blockable.length === 0) return { kind: 'solved', how: 'forced-forbidden' }

  if (completions.size >= 2) {
    // 活四/雙四：守方無五又只能擋一點 → 攻方下一手取剩餘成五點收官。
    return { kind: 'continue', reply: pickBlock(b, blockable, defender, rule) }
  }

  // 衝四：守方唯一不敗應手＝擋成五點 E，擋完驗證攻方 VCF 是否仍在。
  // 找不到即判錯：題庫最小深度 ≤12、驗證搜到 14 層＋寬裕節點數，正解
  // 走出來的局面殘餘 VCF 深度必在預算內，found=false 就是真的斷了。
  const e = blockable[0]
  const ep = posOf(e)
  b[e] = defender
  const r = await solve(b, attacker, rule)
  if (r.found) return { kind: 'continue', reply: ep }
  return { kind: 'wrong', reason: 'loses-vcf' }
}

/** 守方擋點選擇：能順便形成守方自己的四（最頑強、最像實戰）者優先。 */
function pickBlock(b: Board, cells: number[], defender: Color, rule: Rule): Pos {
  const dExact = rule === 'renju' && defender === BLACK
  for (const c of cells) {
    const p = posOf(c)
    b[c] = defender
    const fs = findFoursThrough(b, p.x, p.y, defender, dExact)
    b[c] = EMPTY
    if (fs.length > 0) return p
  }
  return posOf(cells[0])
}
