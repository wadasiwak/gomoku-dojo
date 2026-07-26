// VCF（連續衝四取勝）搜索器。獨立模組：
//   - AI 的殺手鐧（搜索前先解 VCF，有解直接走主變化）
//   - 下一階段題庫 generator 的驗證器：回答「此局面 X 方是否存在 VCF、主變化為何」。
//
// 正確性論證（保守設計）：
//   - 進攻方每手必須「成五」或「成四」；其他手一律不算 VCF。
//   - 進攻方出手前若守方已有一手成五點：進攻方只有自己直接成五才能贏
//     （成四讓半拍，守方先成五）——先檢查再生成。
//   - 進攻方成「活四」或「一手多個成五點」（雙威脅）：守方單手至多擋一點、
//     守方又無成五（已檢查），且守方即使反衝四，下一手輪進攻方直接成五 → 勝。
//   - 進攻方成「衝四」（唯一成五點 E）：守方唯一不敗應手是擋 E（守方反四不擋 E
//     則進攻方直接成五）。守方擋 E 後遞迴；守方擋子若形成守方之四，遞迴層的
//     「守方成五點」檢查會逼進攻方直接成五或宣告此線失敗 → 反四防禦已正確涵蓋。
//   - renju：黑為進攻方時禁手點不可下（四四/長連衝四不可用）；成五（恰五）豁免。
//     白為進攻方時，若守方黑被迫擋的 E 點是黑禁手 → 黑擋不了（下了判負）→ 白勝，
//     這正是「把黑逼進禁手點」的勝著。
//
// 函式不留副作用：搜索過程的落子在返回前全數還原。
// 找到解時回傳主變化（攻守交替的著手序列，以進攻方成五或雙威脅收尾）。
import {
  BLACK,
  EMPTY,
  CELLS,
  SIZE,
  idx,
  opponent,
  posOf,
  type Color,
  type Pos,
  type Rule,
} from './types.ts'
import type { Board } from './board.ts'
import { isWinningMove } from './rules.ts'
import { isForbiddenMove } from './forbidden.ts'
import { findFoursThrough } from './threats.ts'
import { hashBoard, hashKey, xorStone, type Hash } from './zobrist.ts'

export interface VcfOptions {
  /** 進攻方著手數上限（層數以攻方手數計）。 */
  maxDepth?: number
  timeLimitMs?: number
  maxNodes?: number
}

export interface VcfResult {
  found: boolean
  /** 主變化：攻守交替的完整著手序列（攻方先）。 */
  line: Pos[]
  nodes: number
  /** 因時間/節點/深度上限中斷（「未找到」但不保證不存在）。 */
  truncated: boolean
}

interface Ctx {
  b: Board
  attacker: Color
  rule: Rule
  deadline: number
  maxNodes: number
  nodes: number
  truncated: boolean
  hash: Hash
  /** hashKey → 已證實「在剩餘深度 d 內無解」的最大 d。 */
  failMemo: Map<number, number>
}

/** color 在此盤面的所有一手成五點（依規則：renju 黑=恰五、白/gomoku=≥5）。 */
export function findFivePoints(b: Board, color: Color, rule: Rule): number[] {
  const out: number[] = []
  for (let i = 0; i < CELLS; i++) {
    if (b[i] !== EMPTY) continue
    const x = i % SIZE
    const y = Math.floor(i / SIZE)
    if (!nearOwn(b, x, y, color, 4)) continue
    b[i] = color
    const win = isWinningMove(b, x, y, color, rule)
    b[i] = EMPTY
    if (win) out.push(i)
  }
  return out
}

function nearOwn(b: Board, x: number, y: number, color: Color, dist: number): boolean {
  for (const [dx, dy] of [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ] as const) {
    for (let t = -dist; t <= dist; t++) {
      if (t === 0) continue
      const cx = x + t * dx
      const cy = y + t * dy
      if (cx < 0 || cx >= SIZE || cy < 0 || cy >= SIZE) continue
      if (b[idx(cx, cy)] === color) return true
    }
  }
  return false
}

function rec(ctx: Ctx, depth: number, line: Pos[]): boolean {
  ctx.nodes++
  if (ctx.nodes >= ctx.maxNodes || Date.now() > ctx.deadline) {
    ctx.truncated = true
    return false
  }
  if (depth <= 0) {
    ctx.truncated = true
    return false
  }
  const key = hashKey(ctx.hash)
  const failed = ctx.failMemo.get(key)
  if (failed !== undefined && failed >= depth) return false

  const { b, attacker, rule } = ctx
  const defender = opponent(attacker)
  const exact = rule === 'renju' && attacker === BLACK
  // 出手前守方的一手成五點：存在時攻方只有直接成五能贏。
  const defenderFives = findFivePoints(b, defender, rule)

  for (let i = 0; i < CELLS; i++) {
    if (b[i] !== EMPTY) continue
    const x = i % SIZE
    const y = Math.floor(i / SIZE)
    if (!nearOwn(b, x, y, attacker, 4)) continue
    if (exact && isForbiddenMove(b, x, y).forbidden) continue

    b[i] = attacker
    xorStone(ctx.hash, i, attacker)
    const m: Pos = { x, y }
    let win = false

    if (isWinningMove(b, x, y, attacker, rule)) {
      line.push(m) // 成五（含黑恰五豁免），勝
      win = true
    } else if (defenderFives.length === 0) {
      const fours = findFoursThrough(b, x, y, attacker, exact)
      if (fours.length > 0) {
        const completions = new Set<number>()
        for (const f of fours) for (const c of f.completions) completions.add(c)
        if (completions.size >= 2) {
          // 活四或雙四：守方無五又只能擋一點 → 勝。
          line.push(m)
          win = true
        } else {
          const e = [...completions][0]
          const ep = posOf(e)
          if (
            rule === 'renju' &&
            defender === BLACK &&
            isForbiddenMove(b, ep.x, ep.y).forbidden
          ) {
            // 黑被迫擋在自己的禁手點 → 白勝（逼禁手）。
            line.push(m)
            win = true
          } else {
            b[e] = defender
            xorStone(ctx.hash, e, defender)
            line.push(m, ep)
            win = rec(ctx, depth - 1, line)
            if (!win) {
              line.pop()
              line.pop()
            }
            b[e] = EMPTY
            xorStone(ctx.hash, e, defender)
          }
        }
      }
    }

    b[i] = EMPTY
    xorStone(ctx.hash, i, attacker)
    if (win) return true
  }
  if (!ctx.truncated) {
    const prev = ctx.failMemo.get(key)
    if (prev === undefined || prev < depth) ctx.failMemo.set(key, depth)
  }
  return false
}

/** 解 VCF：attacker 方在目前盤面是否存在連續衝四取勝。不改動傳入盤面。 */
export function solveVcf(
  b: Board,
  attacker: Color,
  rule: Rule,
  opts: VcfOptions = {},
): VcfResult {
  const ctx: Ctx = {
    b,
    attacker,
    rule,
    deadline: Date.now() + (opts.timeLimitMs ?? 3000),
    maxNodes: opts.maxNodes ?? 200_000,
    nodes: 0,
    truncated: false,
    hash: hashBoard(b),
    failMemo: new Map(),
  }
  const line: Pos[] = []
  const found = rec(ctx, opts.maxDepth ?? 16, line)
  return { found, line, nodes: ctx.nodes, truncated: !found && ctx.truncated }
}
