// AI 搜索：iterative deepening alpha-beta（negamax）＋ Zobrist 置換表＋時間中斷。
// renju 模式：黑方候選手已在 movegen 濾除禁手（AI 執黑迴避禁手）；
// 白方則自然利用「黑無法落子的點」（含 VCF 的逼禁手勝）。
// 搜索前先跑 VCF（依難度），有解直接走主變化第一手。
import { EMPTY, idx, opponent, type Color, type Pos, type Rule } from './types.ts'
import type { Board } from './board.ts'
import { isWinningMove } from './rules.ts'
import { evaluate, WIN_SCORE } from './eval.ts'
import { generateMoves } from './movegen.ts'
import { solveVcf } from './vcf.ts'
import { hashBoard, hashKey, xorStone, type Hash } from './zobrist.ts'

export interface SearchOptions {
  rule: Rule
  maxDepth: number
  timeLimitMs: number
  width: number
  /** VCF 深度（0 = 不用 VCF）。 */
  vcfDepth: number
}

export interface SearchResult {
  move: Pos | null
  score: number
  depth: number
  nodes: number
  /** 用了 VCF 解（move 即 VCF 主變化第一手）。 */
  viaVcf: boolean
  timedOut: boolean
}

/** 難度分級：限深/限時/候選寬度/VCF 深度。 */
export const LEVELS: Record<1 | 2 | 3 | 4, Omit<SearchOptions, 'rule'>> = {
  1: { maxDepth: 2, timeLimitMs: 400, width: 8, vcfDepth: 0 },
  2: { maxDepth: 4, timeLimitMs: 1000, width: 10, vcfDepth: 6 },
  3: { maxDepth: 6, timeLimitMs: 2000, width: 14, vcfDepth: 12 },
  4: { maxDepth: 10, timeLimitMs: 4000, width: 18, vcfDepth: 20 },
}

const TT_EXACT = 0
const TT_LOWER = 1
const TT_UPPER = 2

interface TTEntry {
  verify: number // hash.hi 全值，防 key 碰撞
  depth: number
  flag: number
  score: number
  move: number // best move cell index（-1 無）
}

class TimeUp extends Error {}

interface SCtx {
  b: Board
  rule: Rule
  deadline: number
  nodes: number
  width: number
  hash: Hash
  tt: Map<number, TTEntry>
}

function negamax(ctx: SCtx, color: Color, depth: number, alpha: number, beta: number, ply: number): number {
  ctx.nodes++
  if ((ctx.nodes & 0xff) === 0 && Date.now() > ctx.deadline) throw new TimeUp()

  const key = hashKey(ctx.hash)
  const entry = ctx.tt.get(key)
  let ttMove = -1
  if (entry && entry.verify === ctx.hash.hi) {
    ttMove = entry.move
    if (entry.depth >= depth) {
      if (entry.flag === TT_EXACT) return entry.score
      if (entry.flag === TT_LOWER && entry.score >= beta) return entry.score
      if (entry.flag === TT_UPPER && entry.score <= alpha) return entry.score
    }
  }
  if (depth <= 0) return evaluate(ctx.b, color)

  const moves = generateMoves(ctx.b, color, ctx.rule, ctx.width)
  if (moves.length === 0) return -(WIN_SCORE - ply) // 無合法手（renju 黑全禁手）＝敗

  // 置換表著法排到最前
  if (ttMove >= 0) {
    const k = moves.findIndex((m) => idx(m.x, m.y) === ttMove)
    if (k > 0) {
      const [m] = moves.splice(k, 1)
      moves.unshift(m)
    }
  }

  const alphaOrig = alpha
  let best = -Infinity
  let bestMove = -1
  for (const m of moves) {
    const cell = idx(m.x, m.y)
    ctx.b[cell] = color
    xorStone(ctx.hash, cell, color)
    let score: number
    try {
      if (isWinningMove(ctx.b, m.x, m.y, color, ctx.rule)) {
        score = WIN_SCORE - ply - 1 // 越快贏分越高
      } else {
        score = -negamax(ctx, opponent(color), depth - 1, -beta, -alpha, ply + 1)
      }
    } finally {
      // TimeUp 中斷也要還原盤面
      ctx.b[cell] = EMPTY
      xorStone(ctx.hash, cell, color)
    }
    if (score > best) {
      best = score
      bestMove = cell
    }
    if (best > alpha) alpha = best
    if (alpha >= beta) break
  }

  const flag = best <= alphaOrig ? TT_UPPER : best >= beta ? TT_LOWER : TT_EXACT
  ctx.tt.set(key, { verify: ctx.hash.hi, depth, flag, score: best, move: bestMove })
  return best
}

/** 找 color 方的最佳著手。不改動傳入盤面。 */
export function search(b: Board, color: Color, opts: SearchOptions): SearchResult {
  const start = Date.now()
  // 1) VCF 殺手鐧
  if (opts.vcfDepth > 0) {
    const vcf = solveVcf(b, color, opts.rule, {
      maxDepth: opts.vcfDepth,
      timeLimitMs: Math.min(opts.timeLimitMs * 0.4, 2000),
    })
    if (vcf.found && vcf.line.length > 0) {
      return {
        move: vcf.line[0],
        score: WIN_SCORE,
        depth: 0,
        nodes: vcf.nodes,
        viaVcf: true,
        timedOut: false,
      }
    }
  }
  // 2) iterative deepening alpha-beta
  const ctx: SCtx = {
    b,
    rule: opts.rule,
    deadline: start + opts.timeLimitMs,
    nodes: 0,
    width: opts.width,
    hash: hashBoard(b),
    tt: new Map(),
  }
  let bestMove: Pos | null = null
  let bestScore = 0
  let reached = 0
  let timedOut = false
  for (let depth = 1; depth <= opts.maxDepth; depth++) {
    try {
      const moves = generateMoves(b, color, opts.rule, opts.width)
      if (moves.length === 0) break
      // root 層自己展開，才能拿到著手
      let alpha = -Infinity
      let localBest: Pos | null = null
      // 上一輪最佳排最前
      if (bestMove) {
        const k = moves.findIndex((m) => m.x === bestMove!.x && m.y === bestMove!.y)
        if (k > 0) {
          const [m] = moves.splice(k, 1)
          moves.unshift(m)
        }
      }
      for (const m of moves) {
        const cell = idx(m.x, m.y)
        b[cell] = color
        xorStone(ctx.hash, cell, color)
        let score: number
        try {
          if (isWinningMove(b, m.x, m.y, color, opts.rule)) {
            score = WIN_SCORE - 1
          } else {
            score = -negamax(ctx, opponent(color), depth - 1, -Infinity, -alpha, 1)
          }
        } finally {
          b[cell] = EMPTY
          xorStone(ctx.hash, cell, color)
        }
        if (score > alpha || localBest === null) {
          alpha = score
          localBest = { x: m.x, y: m.y }
        }
      }
      bestMove = localBest
      bestScore = alpha
      reached = depth
      if (alpha >= WIN_SCORE - 100) break // 已見必勝，不必更深
    } catch (e) {
      if (e instanceof TimeUp) {
        timedOut = true
        break
      }
      throw e
    }
  }
  return { move: bestMove, score: bestScore, depth: reached, nodes: ctx.nodes, viaVcf: false, timedOut }
}
