// VCF 題庫離線 generator：引擎自對弈（seed 固定、無時鐘依賴 → 結果 deterministic）
// 產生自然盤面，逐位置以 solveVcf 驗證「攻方存在 VCF」，並由淺至深求出
// 「最小 VCF 深度」（每個較淺層都要 truncated=false 證實無解才收，品質優先）。
//
//   node scripts/gen-puzzles.mjs                    # 全量（寫入 src/puzzles/puzzles.json）
//   node scripts/gen-puzzles.mjs --games 50 --dry   # 校準：只跑 50 局、印統計不寫檔
//
// 難度分級（依最小 VCF 深度＝攻方手數）：初級 2–3、中級 4–7、高級 8+。
// 每局至多收 1 題（同局相鄰位置高度重複）；全域以盤面+攻方去重。
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Game } from '../src/engine/game.ts'
import { generateMoves } from '../src/engine/movegen.ts'
import { solveVcf, findFivePoints } from '../src/engine/vcf.ts'
import { serializeRecord } from '../src/engine/record.ts'
import { isWinningMove } from '../src/engine/rules.ts'
import { isForbiddenMove } from '../src/engine/forbidden.ts'
import { cloneBoard, boardToString } from '../src/engine/board.ts'
import { findFoursThrough } from '../src/engine/threats.ts'
import {
  BLACK,
  WHITE,
  CELLS,
  SIZE,
  DIRS,
  idx,
  EMPTY,
  opponent,
  posOf,
} from '../src/engine/types.ts'
import { minVcfDepth, DIFF_OF_DEPTH } from './puzzle-verify.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const OUT = join(ROOT, 'src', 'puzzles', 'puzzles.json')

const args = process.argv.slice(2)
const argOf = (name, dflt) => {
  const i = args.indexOf(name)
  return i >= 0 ? Number(args[i + 1]) : dflt
}
const SEED = argOf('--seed', 20260726)
const MAX_GAMES = argOf('--games', 8000)
const DRY = args.includes('--dry')

/** 目標題數（湊不滿以品質優先，回報實際數量；高級題產率天生低）。 */
const QUOTA = { easy: 30, medium: 42, hard: 20 }
/** 掃描的盤面子數範圍（dense 局深殺網長在子多處，上限放寬）。 */
const SCAN = {
  mixed: { min: 8, max: 34 },
  dense: { min: 12, max: 44 },
}
const PREFILTER = { maxDepth: 12, maxNodes: 300_000, timeLimitMs: 1e15 }

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function nearSameColor(board, i, color) {
  const x = i % SIZE
  const y = Math.floor(i / SIZE)
  for (const [dx, dy] of DIRS) {
    for (let t = -4; t <= 4; t++) {
      if (t === 0) continue
      const cx = x + t * dx
      const cy = y + t * dy
      if (cx < 0 || cx >= SIZE || cy < 0 || cy >= SIZE) continue
      if (board[idx(cx, cy)] === color) return true
    }
  }
  return false
}

/** color 一手可成「活四/雙四」（>=2 個成五點）的落點（renju 黑排除禁手點——
 *  黑下不了就不構成威脅）。這些點若放著不擋，下一手就是平凡的一手勝。 */
function straightFourPoints(board, color, rule) {
  const exact = rule === 'renju' && color === BLACK
  const out = []
  for (let i = 0; i < CELLS; i++) {
    if (board[i] !== EMPTY || !nearSameColor(board, i, color)) continue
    const p = posOf(i)
    if (exact && isForbiddenMove(board, p.x, p.y).forbidden) continue
    board[i] = color
    const fours = findFoursThrough(board, p.x, p.y, color, exact)
    board[i] = EMPTY
    const comps = new Set()
    for (const f of fours) for (const c of f.completions) comps.add(c)
    if (comps.size >= 2) out.push(i)
  }
  return out
}

/** 自對弈一局，兩種風格：
 *  - mixed：一方「攻勢」（挑前段高分手）、另一方偏散漫（給攻方留出攻擊網）。
 *  - dense：雙方皆攻、局面長而密（深 VCF 只從這種殺網長出來）。
 *  共通：守方會擋成五點與活四點（不擋會淪為一手勝的垃圾局面），
 *  並排除立即成五的手讓對局延續。回傳各手後的盤面快照。 */
function simulate(rule, rng, style, aggressive) {
  const g = new Game(rule)
  const plies =
    style === 'dense' ? 36 + Math.floor(rng() * 18) : 16 + Math.floor(rng() * 28)
  const snapshots = [] // snapshots[t] = 第 t 手後盤面（t 從 1 起）
  while (g.moves.length < plies && g.result.kind === 'ongoing') {
    const color = g.toMove
    // 對手有一手成五點 → 必須擋（否則盤面留著死四，垃圾局面）。
    // 多個成五點＝守不住、renju 黑擋點是禁手＝擋不了：終止這局。
    const threat = findFivePoints(g.board, opponent(color), rule)
    if (threat.length > 1) break
    if (threat.length === 1) {
      const p = posOf(threat[0])
      if (rule === 'renju' && color === BLACK && isForbiddenMove(g.board, p.x, p.y).forbidden)
        break
      g.play(p.x, p.y)
      snapshots.push(cloneBoard(g.board))
      continue
    }
    // 對手有活四點（一手成活四）→ 高機率去擋/搶佔該點，維持局面張力。
    const fourPts = straightFourPoints(g.board, opponent(color), rule)
    if (fourPts.length > 0 && rng() < 0.92) {
      const legal = fourPts.filter((c) => {
        if (rule !== 'renju' || color !== BLACK) return true
        const p = posOf(c)
        return !isForbiddenMove(g.board, p.x, p.y).forbidden
      })
      if (legal.length > 0) {
        const p = posOf(legal[Math.floor(rng() * legal.length)])
        g.play(p.x, p.y)
        snapshots.push(cloneBoard(g.board))
        continue
      }
    }
    const cands = generateMoves(g.board, color, rule, 14)
    if (cands.length === 0) break
    const pool = cands.filter((m) => {
      const c = idx(m.x, m.y)
      g.board[c] = color
      const win = isWinningMove(g.board, m.x, m.y, color, rule)
      g.board[c] = EMPTY
      return !win
    })
    if (pool.length === 0) break
    let pick
    if (style === 'dense') {
      // 雙方皆攻：從前 3 高分手挑，偶爾亂走擾動避免定式化。
      if (rng() < 0.25 && pool.length > 3)
        pick = pool[3 + Math.floor(rng() * (Math.min(10, pool.length) - 3))]
      else pick = pool[Math.floor(Math.pow(rng(), 2) * Math.min(3, pool.length))]
    } else if (color === aggressive) {
      const k = Math.min(4, pool.length)
      pick = pool[Math.floor(Math.pow(rng(), 2) * k)]
    } else if (rng() < 0.42 && pool.length > 4) {
      // 守方偶爾「鬆手」走緩著，讓攻方攢出深一點的殺網。
      pick = pool[4 + Math.floor(rng() * (Math.min(12, pool.length) - 4))]
    } else {
      const k = Math.min(8, pool.length)
      pick = pool[Math.floor(rng() * k)]
    }
    g.play(pick.x, pick.y)
    snapshots.push(cloneBoard(g.board))
  }
  return { moves: g.moves, snapshots }
}

const rng = mulberry32(SEED)
const accepted = []
const seen = new Set()
const stats = { games: 0, prefilterHits: 0, unproven: 0, dup: 0, quotaFull: 0, tooShallow: 0 }
const t0 = Date.now()

const quotaLeft = () =>
  Object.entries(QUOTA).some(([k, v]) => accepted.filter((p) => p.difficulty === k).length < v)

const tierCount = (k) => accepted.filter((p) => p.difficulty === k).length

for (let game = 0; game < MAX_GAMES && quotaLeft(); game++) {
  stats.games++
  const rule = game % 5 < 3 ? 'renju' : 'gomoku' // 60% 連珠 / 40% 無禁手
  const aggressive = game % 2 === 0 ? BLACK : WHITE
  // 初/中級額滿後只缺高級 → 全轉 dense；否則 1/3 局跑 dense。
  // （style 只依 accepted 狀態與 game index 決定，deterministic。）
  const style =
    tierCount('easy') >= QUOTA.easy && tierCount('medium') >= QUOTA.medium
      ? 'dense'
      : game % 3 === 2
        ? 'dense'
        : 'mixed'
  const { moves, snapshots } = simulate(rule, rng, style, aggressive)

  // 全局掃描、取「最深」的可收位置（同局相鄰位置高度重複，每局至多收一題；
  // 越接近終盤 VCF 越淺，挑最深的才擠得出中高難度）。
  let best = null
  const scan = SCAN[style]
  for (let t = Math.min(moves.length, scan.max); t >= scan.min; t--) {
    const board = snapshots[t - 1]
    const attacker = t % 2 === 0 ? BLACK : WHITE
    const pre = solveVcf(board, attacker, rule, PREFILTER)
    if (!pre.found) continue
    stats.prefilterHits++

    const { dMin, line, proven } = minVcfDepth(board, attacker, rule)
    if (dMin < 2) {
      stats.tooShallow++
      continue
    }
    if (!proven) {
      stats.unproven++
      continue
    }
    const difficulty = DIFF_OF_DEPTH(dMin)
    if (accepted.filter((p) => p.difficulty === difficulty).length >= QUOTA[difficulty]) {
      stats.quotaFull++
      continue
    }
    if (!best || dMin > best.dMin) best = { t, attacker, board, dMin, line, difficulty }
  }
  if (best) {
    const key = rule + '|' + best.attacker + '|' + boardToString(best.board)
    if (seen.has(key)) {
      stats.dup++
    } else {
      seen.add(key)
      accepted.push({
        rule,
        attacker: best.attacker === BLACK ? 'black' : 'white',
        record: serializeRecord({ rule, moves: moves.slice(0, best.t) }),
        stones: best.t,
        vcfDepth: best.dMin,
        difficulty: best.difficulty,
        solution: best.line.map((p) => ({ x: p.x, y: p.y })),
        verify: {
          minDepthProven: true,
          maxNodesPerCall: 1_500_000,
          solver: 'solveVcf-v1',
        },
      })
    }
  }
  if (game % 100 === 99) {
    const dist = countBy(accepted, 'difficulty')
    console.log(
      `  ${game + 1} 局：收 ${accepted.length} 題`,
      dist,
      `${((Date.now() - t0) / 1000).toFixed(0)}s`,
    )
  }
}

function countBy(arr, key) {
  const out = {}
  for (const p of arr) out[p[key]] = (out[p[key]] ?? 0) + 1
  return out
}

// 穩定排序＋編號：難度（淺→深）→ 深度 → 規則 → 收錄順序。
const ORDER = { easy: 0, medium: 1, hard: 2 }
accepted.sort(
  (a, b) =>
    ORDER[a.difficulty] - ORDER[b.difficulty] ||
    a.vcfDepth - b.vcfDepth ||
    a.rule.localeCompare(b.rule) ||
    a.record.localeCompare(b.record),
)
accepted.forEach((p, i) => {
  p.id = `p${String(i + 1).padStart(3, '0')}`
})

const summary = {
  total: accepted.length,
  byDifficulty: countBy(accepted, 'difficulty'),
  byRule: countBy(accepted, 'rule'),
  byDepth: countBy(accepted, 'vcfDepth'),
  stats,
  elapsedSec: Math.round((Date.now() - t0) / 1000),
}
console.log('=== 產題統計 ===')
console.log(JSON.stringify(summary, null, 2))

if (!DRY) {
  mkdirSync(dirname(OUT), { recursive: true })
  const doc = {
    version: 1,
    seed: SEED,
    games: MAX_GAMES,
    generator: 'gen-puzzles.mjs（引擎自對弈＋solveVcf 最小深度證明）',
    puzzles: accepted.map((p) => ({
      id: p.id,
      rule: p.rule,
      attacker: p.attacker,
      record: p.record,
      stones: p.stones,
      vcfDepth: p.vcfDepth,
      difficulty: p.difficulty,
      solution: p.solution,
      verify: p.verify,
    })),
  }
  writeFileSync(OUT, JSON.stringify(doc, null, 1) + '\n')
  console.log(`寫入 ${OUT}（${accepted.length} 題）`)
}
