// AI 搜索：iterative deepening alpha-beta（negamax）＋ Zobrist 置換表＋時間中斷。
// renju 模式：黑方候選手已在 movegen 濾除禁手（AI 執黑迴避禁手）；
// 白方則自然利用「黑無法落子的點」（含 VCF 的逼禁手勝）。
// 搜索前先跑 VCF（依難度），有解直接走主變化第一手。
//
// 速度判斷（國手框架二輪：五子棋＝比材料和速度）：
//   出手前雙方都解 VCF、比殺的快慢決定攻守——自己有 VCF 照走（上）；
//   自己沒有而對手有 → 進防守模式：候選手限定「下完之後對手的 VCF 消失
//   或變慢（同深度預算內解不出）」的手，逐候選重解驗證、預算控制，不再漫遊。
//   驗證時若候選本身是成四手，先把「對手被迫擋」的交換走完再解——否則
//   拖延型衝四會因「對手下一手得先應四」騙過驗證；衝完對手殺仍在的四
//   ＝送對手一顆有連結的子＋自己線廢掉，正是要擋掉的手（實戰 35 手 K8 案例：
//   白在 C10 有四連衝殺，黑 K8 衝四逼白 J8 後白殺原封不動，J8 反而接活
//   白右下攻勢成為終局勝線的一員）。詳見 search() 內防守模式段。
//   VCT（四三接力）快慢比較尚未實作，見 search() 內 TODO。
//
// Forced-reply extension（國手回饋：AI 亂衝四＝horizon effect）：
//   一手成四逼對方應（不擋成五點即輸），這組交換近乎不帶新資訊——
//   固定限深下每組衝四交換卻吃掉 2 ply，AI 學會用無意義衝四把不利局面推出
//   視野。修法：成四手＋被迫應手「整組」不消耗深度（成四時扣 2 點延伸額度、
//   應手免費），把連續衝四交換算穿、用交換後的真實局面評分。
//   ⚠️ 必須整組一起延伸：若只延伸成四手（每組交換耗 1 ply），延伸線的
//   末端奇偶會翻轉——攻方衝一次四就多賺一手「視野內的自由手」，搜索反而
//   更愛無意義衝四（實測 depth 2/4 會回頭選衝四）。整組延伸保持奇偶不變。
//   延伸額度雙方分開記帳、各上限 MAX_EXT ply 防爆炸（共用額度會讓自己的
//   衝四遮蔽對手反殺鏈，見 MAX_EXT 註解）；置換表記帳連同雙方剩餘額度與
//   被迫應手旗標一起比較（見 TTEntry.extMine/extFoe/free）。
import { BLACK, DIRS, EMPTY, SIZE, idx, inBoard, opponent, posOf, type Color, type Pos, type Rule } from './types.ts'
import type { Board } from './board.ts'
import { isWinningMove } from './rules.ts'
import { isForbiddenMove } from './forbidden.ts'
import { evaluate, scoreMoveLocal, WIN_SCORE } from './eval.ts'
import { generateMoves, type ScoredMove } from './movegen.ts'
import { findFivePoints, solveVcf } from './vcf.ts'
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
  /** 進了防守模式：對手有 VCF 而自己沒有，候選手已限定為能消解/拖慢該殺的手。 */
  viaDefense: boolean
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

/** 每條路徑「每一方各自」的成四延伸額度（ply；一組衝四交換耗攻方 2）。
 *  ⚠️ 額度必須分邊記帳：若共用一個額度，root 的無意義衝四會先扣光額度、
 *  讓「對手的連衝反殺鏈」在這條線裡看不完整——其他安靜線看得到損失、
 *  分數反而更差，衝四又贏了（horizon effect 以額度形式殘留；實戰 35 手
 *  K8 案例：黑衝四扣 2 後剩 6，白的四連衝殺需 8，恰好被遮蔽）。 */
const MAX_EXT = 8

interface TTEntry {
  verify: number // hash.hi 全值，防 key 碰撞
  depth: number
  /** 存入時的剩餘延伸額度（extMine=手番方、extFoe=對方）。延伸讓「同 depth」
   *  不再等價：額度較多的搜索樹嚴格較深，故 cutoff 需 entry.depth >= depth
   *  且兩個額度都 >= 查詢值才成立。 */
  extMine: number
  extFoe: number
  /** 存入時的被迫應手旗標（0/1）。free=1 的節點應手不消耗深度＝樹嚴格較深，
   *  可服務 free=0 的查詢；反之不行。 */
  free: number
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

/** (x,y) 剛下的 color 子若成四（含衝四/活四），回傳全部有效成五點；否則 null。
 *  成四逼對方應手 → 延伸，成五點集合＝對方唯一不輸在下一手的應點。
 *  語意同 threats.findFoursThrough 的 completions 聯集（含連珠黑的恰五檢查），
 *  但走零配置的滑窗掃描——每個節點的每一手都會呼叫，熱路徑不容 Map/字串 key。 */
function fourCompletions(b: Board, x: number, y: number, color: Color, rule: Rule): number[] | null {
  const exact = rule === 'renju' && color === BLACK
  let out: number[] | null = null
  for (let d = 0; d < DIRS.length; d++) {
    const [dx, dy] = DIRS[d]
    for (let s = -4; s <= 0; s++) {
      let mine = 0
      let empty = -1
      let bad = false
      for (let k = 0; k < 5; k++) {
        const cx = x + (s + k) * dx
        const cy = y + (s + k) * dy
        if (!inBoard(cx, cy)) {
          bad = true
          break
        }
        const v = b[idx(cx, cy)]
        if (v === color) mine++
        else if (v === EMPTY) {
          if (empty >= 0) {
            bad = true // 第二個空點 → 非四
            break
          }
          empty = idx(cx, cy)
        } else {
          bad = true // 窗內有對方子
          break
        }
      }
      if (bad || mine !== 4) continue
      if (exact) {
        // 補空成 >=6 長連對連珠黑無效 → 不是四。
        const bx = x + (s - 1) * dx
        const by = y + (s - 1) * dy
        if (inBoard(bx, by) && b[idx(bx, by)] === color) continue
        const ax = x + (s + 5) * dx
        const ay = y + (s + 5) * dy
        if (inBoard(ax, ay) && b[idx(ax, ay)] === color) continue
      }
      if (!out) out = [empty]
      else if (!out.includes(empty)) out.push(empty)
    }
  }
  return out
}

/** forced ≠ null 時：本節點手番方正被對方成四逼應（上一手是延伸過的成四），
 *  forced 即對方的成五點集合。此時只需考慮（a）自己一手成五、（b）落在
 *  forced 點上擋（或兼擋兼攻）——其餘應手下一手就被對方成五，必劣於擋點
 *  （價值保持不變的剪枝），且被迫應手不消耗深度。 */
function negamax(
  ctx: SCtx,
  color: Color,
  depth: number,
  extMine: number,
  extFoe: number,
  forced: number[] | null,
  alpha: number,
  beta: number,
  ply: number,
): number {
  ctx.nodes++
  if ((ctx.nodes & 0xff) === 0 && Date.now() > ctx.deadline) throw new TimeUp()

  const free = forced !== null
  const key = hashKey(ctx.hash)
  const entry = ctx.tt.get(key)
  let ttMove = -1
  if (entry && entry.verify === ctx.hash.hi) {
    ttMove = entry.move
    if (
      entry.depth >= depth &&
      entry.extMine >= extMine &&
      entry.extFoe >= extFoe &&
      entry.free >= (free ? 1 : 0)
    ) {
      if (entry.flag === TT_EXACT) return entry.score
      if (entry.flag === TT_LOWER && entry.score >= beta) return entry.score
      if (entry.flag === TT_UPPER && entry.score <= alpha) return entry.score
    }
  }
  if (depth <= 0) return evaluate(ctx.b, color, ctx.rule)

  // 被迫應手節點的合法選項只有（a）自己一手成五、（b）擋在對方成五點——
  // 精確建構這個小集合。跑全量 movegen（每空點局部打分＋禁手掃描）在這裡
  // 是延伸樹的最大熱點（延伸讓淺層節點數爆數十倍），而且寬度截斷還可能把
  // 唯一擋點擠出候選（局部分數低的擋點會被誤判必敗）。
  let moves: Pos[]
  if (forced) {
    const cells: number[] = findFivePoints(ctx.b, color, ctx.rule) // 成五優先
    for (const c of forced) if (!cells.includes(c)) cells.push(c)
    const filterForbidden = ctx.rule === 'renju' && color === BLACK
    moves = []
    for (const c of cells) {
      const x = c % SIZE
      const y = (c / SIZE) | 0
      if (filterForbidden && isForbiddenMove(ctx.b, x, y).forbidden) continue
      moves.push({ x, y })
    }
  } else {
    moves = generateMoves(ctx.b, color, ctx.rule, ctx.width)
  }
  if (moves.length === 0) return -(WIN_SCORE - ply) // 無合法手（renju 黑全禁手／被逼應卻無點可擋）＝敗

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
    let score: number | null = null
    try {
      if (isWinningMove(ctx.b, m.x, m.y, color, ctx.rule)) {
        score = WIN_SCORE - ply - 1 // 越快贏分越高
      } else if (forced && !forced.includes(cell)) {
        // 被逼應卻不擋又不成五 → 對方下一手成五，必劣於擋點，剪掉。
        score = null
      } else {
        // 被迫應手免費；成四且己方額度夠（一組交換扣己方 2）則延伸並傳成五點給子節點。
        let childDepth = free ? depth : depth - 1
        let myExt = extMine
        let childForced: number[] | null = null
        if (extMine >= 2) {
          childForced = fourCompletions(ctx.b, m.x, m.y, color, ctx.rule)
          if (childForced) {
            childDepth = depth
            myExt = extMine - 2
          }
        }
        // 子節點手番換人：extMine/extFoe 對調。
        score = -negamax(ctx, opponent(color), childDepth, extFoe, myExt, childForced, -beta, -alpha, ply + 1)
      }
    } finally {
      // TimeUp 中斷也要還原盤面
      ctx.b[cell] = EMPTY
      xorStone(ctx.hash, cell, color)
    }
    if (score === null) continue
    if (score > best) {
      best = score
      bestMove = cell
    }
    if (best > alpha) alpha = best
    if (alpha >= beta) break
  }
  // 被逼應且無子可擋（擋點是禁手，已被候選建構濾掉）→ 對方下一手成五。
  if (bestMove === -1 && best === -Infinity) best = -(WIN_SCORE - ply - 2)

  const flag = best <= alphaOrig ? TT_UPPER : best >= beta ? TT_LOWER : TT_EXACT
  ctx.tt.set(key, {
    verify: ctx.hash.hi,
    depth,
    extMine,
    extFoe,
    free: free ? 1 : 0,
    flag,
    score: best,
    move: bestMove,
  })
  return best
}

/** 防守模式的候選過濾：對手（foe）有 VCF、自己沒有時，只留下「下完之後
 *  foe 的 VCF 在同深度預算內解不出（＝消失或變慢）」的候選手。
 *  候選本身是成四手時，先把 foe 的被迫擋子走完再驗——拖延型衝四（衝完
 *  foe 的殺原封不動）在這裡被剔除；反之「衝四搶佔殺線要點」的手會存活。
 *  驗證一律以「foe 先手」解（等於讓 foe 一手的 null-move 檢驗，偏保守）。
 *  回傳 null = 沒有任何候選能消解（真死局）或預算不足，交回一般搜索。 */
function filterDefenseMoves(
  b: Board,
  color: Color,
  opts: SearchOptions,
  foeVcfLine: Pos[],
  deadline: number,
): ScoredMove[] | null {
  const foe = opponent(color)
  const baseAtk = Math.ceil(foeVcfLine.length / 2) // foe 殺所需的攻方手數
  const filterForbidden = opts.rule === 'renju' && color === BLACK
  // 候選 = movegen（放寬幾格）∪ foe 殺線 PV 上的空點（擋點/搶點常在其中，
  // 但可能離己方棋子超過 movegen 的鄰域半徑）。
  const cand = generateMoves(b, color, opts.rule, opts.width + 6)
  const seen = new Set(cand.map((m) => idx(m.x, m.y)))
  for (const p of foeVcfLine) {
    const cell = idx(p.x, p.y)
    if (b[cell] !== EMPTY || seen.has(cell)) continue
    if (filterForbidden && isForbiddenMove(b, p.x, p.y).forbidden) continue
    seen.add(cell)
    cand.push({ x: p.x, y: p.y, score: scoreMoveLocal(b, p.x, p.y, color) })
  }
  cand.sort((a, z) => z.score - a.score)

  const survivors: ScoredMove[] = []
  for (const m of cand) {
    const now = Date.now()
    if (now > deadline) break // 預算用盡：用已驗出的倖存者
    const cell = idx(m.x, m.y)
    b[cell] = color
    let blockCell = -1
    let keep: boolean
    if (isWinningMove(b, m.x, m.y, color, opts.rule)) {
      keep = true // 直接成五（理論上 VCF 已抓，保險）
    } else {
      const comp = fourCompletions(b, m.x, m.y, color, opts.rule)
      if (comp && comp.length >= 2) {
        keep = true // 活四/雙四＝下一手必成五，快過 foe
      } else {
        if (comp && comp.length === 1) {
          const ep = posOf(comp[0])
          if (opts.rule === 'renju' && foe === BLACK && isForbiddenMove(b, ep.x, ep.y).forbidden) {
            b[cell] = EMPTY
            survivors.push(m) // foe 擋點是禁手＝擋不了，勝著
            continue
          }
          blockCell = comp[0]
          b[blockCell] = foe // 被迫擋子走完，再看 foe 的殺還在不在
        }
        const v = solveVcf(b, foe, opts.rule, {
          maxDepth: baseAtk,
          timeLimitMs: Math.max(50, Math.min(300, deadline - now)),
          maxNodes: 30_000,
        })
        keep = !v.found
      }
    }
    if (blockCell >= 0) b[blockCell] = EMPTY
    b[cell] = EMPTY
    if (keep) survivors.push(m)
  }
  return survivors.length > 0 ? survivors : null
}

/** 找 color 方的最佳著手。不改動傳入盤面。 */
export function search(b: Board, color: Color, opts: SearchOptions): SearchResult {
  const start = Date.now()
  // 1) VCF 殺手鐧：自己的殺最快 → 照走
  if (opts.vcfDepth > 0) {
    const vcf = solveVcf(b, color, opts.rule, {
      maxDepth: opts.vcfDepth,
      timeLimitMs: Math.min(opts.timeLimitMs * 0.35, 2000),
    })
    if (vcf.found && vcf.line.length > 0) {
      return {
        move: vcf.line[0],
        score: WIN_SCORE,
        depth: 0,
        nodes: vcf.nodes,
        viaVcf: true,
        viaDefense: false,
        timedOut: false,
      }
    }
  }
  // 2) 速度判斷：自己沒殺，對手有 → 防守模式，候選限縮成「消解/拖慢對手殺」的手。
  //    TODO（VCT-lite）：目前只比 VCF 的快慢；四三接力（VCT）的淺層互解尚未實作，
  //    「對手只有 VCT」的局面仍交給一般搜索＋延伸去頂。
  let rootMoves: ScoredMove[] | null = null
  if (opts.vcfDepth > 0) {
    const foeVcf = solveVcf(b, opponent(color), opts.rule, {
      maxDepth: opts.vcfDepth,
      timeLimitMs: Math.min(opts.timeLimitMs * 0.2, 1200),
      maxNodes: 120_000,
    })
    if (foeVcf.found && foeVcf.line.length > 0) {
      rootMoves = filterDefenseMoves(b, color, opts, foeVcf.line, start + opts.timeLimitMs * 0.7)
    }
  }
  // 3) iterative deepening alpha-beta
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
      const moves = rootMoves ? [...rootMoves] : generateMoves(b, color, opts.rule, opts.width)
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
            // root 的成四同樣整組延伸（扣己方額度 2、對方應手免費），與 negamax 內一致。
            const forced = fourCompletions(b, m.x, m.y, color, opts.rule)
            score = forced
              ? -negamax(ctx, opponent(color), depth, MAX_EXT, MAX_EXT - 2, forced, -Infinity, -alpha, 1)
              : -negamax(ctx, opponent(color), depth - 1, MAX_EXT, MAX_EXT, null, -Infinity, -alpha, 1)
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
  // 防守模式下若限時連 depth 1 都沒跑完，退而走過濾後的首選（仍是驗證過的防守手）。
  if (!bestMove && rootMoves && rootMoves.length > 0) bestMove = { x: rootMoves[0].x, y: rootMoves[0].y }
  return {
    move: bestMove,
    score: bestScore,
    depth: reached,
    nodes: ctx.nodes,
    viaVcf: false,
    viaDefense: rootMoves !== null,
    timedOut,
  }
}
