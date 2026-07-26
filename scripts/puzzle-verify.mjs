// 題庫共用驗證邏輯：generator 產題與 check 全量重驗共用同一套（單一真相）。
// 以 node 直接跑 TS 引擎（node >=23 type stripping；引擎 import 都帶 .ts 副檔名）。
import { Game } from '../src/engine/game.ts'
import { parseRecord } from '../src/engine/record.ts'
import { solveVcf, findFivePoints } from '../src/engine/vcf.ts'
import { isForbiddenMove } from '../src/engine/forbidden.ts'
import { BLACK, WHITE, posOf } from '../src/engine/types.ts'

/** 驗證用求解參數：不設時限（結果只依盤面 → 可重跑 deterministic），
 *  只用節點上限當保險絲；觸頂（truncated）的題一律不收。 */
export const VERIFY_MAX_NODES = 1_500_000
export const VERIFY_MAX_DEPTH = 12

const solveAt = (board, attacker, rule, depth) =>
  solveVcf(board, attacker, rule, {
    maxDepth: depth,
    maxNodes: VERIFY_MAX_NODES,
    timeLimitMs: 1e15,
  })

/** 求最小 VCF 深度（攻方手數）：由淺至深逐層求解。
 *  回傳 { dMin, line, proven, nodes }；dMin=0 表示 VERIFY_MAX_DEPTH 內無解。
 *
 *  proven 語意注意：solveVcf 的 truncated 在「深度預算用盡」時也會設 true——
 *  那不影響「深度 ≤ d 內無解」的證明（深度上限本來就是命題邊界）；
 *  只有**節點上限**被打到（nodes >= maxNodes，時限設為無限不會觸發）
 *  才代表較淺層沒搜完、最小深度下界不成立。 */
export function minVcfDepth(board, attacker, rule, maxDepth = VERIFY_MAX_DEPTH) {
  let nodes = 0
  let proven = true
  for (let d = 1; d <= maxDepth; d++) {
    const r = solveAt(board, attacker, rule, d)
    nodes += r.nodes
    if (r.found) return { dMin: d, line: r.line, proven, nodes }
    if (r.nodes >= VERIFY_MAX_NODES) proven = false
  }
  return { dMin: 0, line: [], proven, nodes }
}

export const DIFF_OF_DEPTH = (d) => (d <= 3 ? 'easy' : d <= 7 ? 'medium' : 'hard')
export const DIFF_LABEL = { easy: '初級', medium: '中級', hard: '高級' }

/** 全量重驗一題。回傳 { ok, errors, dMin }。 */
export function verifyPuzzle(p) {
  const errors = []
  const rec = parseRecord(p.record)
  if (!rec) return { ok: false, errors: ['record 無法解析'], dMin: 0 }
  if (rec.rule !== p.rule) errors.push(`record 規則 ${rec.rule} != ${p.rule}`)
  const g = Game.fromRecord(rec)
  if (!g) return { ok: false, errors: ['record 重播非法（占用/禁手判負）'], dMin: 0 }
  if (g.result.kind !== 'ongoing') errors.push(`盤面已終局：${JSON.stringify(g.result)}`)
  const attacker = p.attacker === 'black' ? BLACK : WHITE
  if (g.toMove !== attacker) errors.push(`手番 ${g.toMove} 非攻方 ${p.attacker}`)
  if (errors.length) return { ok: false, errors, dMin: 0 }

  const { dMin, proven } = minVcfDepth(g.board, attacker, p.rule)
  if (dMin === 0) errors.push('攻方無 VCF')
  else {
    if (!proven) errors.push('最小深度未證實（較淺層搜索被截斷）')
    if (dMin !== p.vcfDepth) errors.push(`最小 VCF 深度 ${dMin} != 標註 ${p.vcfDepth}`)
    if (DIFF_OF_DEPTH(dMin) !== p.difficulty)
      errors.push(`難度 ${p.difficulty} 與深度 ${dMin} 不符`)
  }
  // 附帶驗 solution 主變化可照走且終局為攻方勝（雙威脅結尾以「仍有 VCF」驗）。
  const sim = Game.fromRecord(rec)
  for (const m of p.solution) {
    if (!sim.play(m.x, m.y)) {
      errors.push(`solution 著手 (${m.x},${m.y}) 非法`)
      break
    }
  }
  if (!errors.some((e) => e.startsWith('solution'))) {
    if (sim.result.kind === 'win') {
      const winner = sim.result.winner === BLACK ? 'black' : 'white'
      if (winner !== p.attacker) errors.push('solution 終局勝方非攻方')
    } else {
      // 主變化以雙威脅或逼禁手收尾（solver 在該手即宣告勝）：
      //   - 攻方成五點 >= 2：守方單手至多擋一點 → 攻方必得一五。
      //   - renju 白攻、唯一成五點是黑禁手：黑擋不進 → 白必得五。
      const fives = findFivePoints(sim.board, attacker, p.rule)
      const forcedForbidden =
        fives.length === 1 &&
        p.rule === 'renju' &&
        attacker === WHITE &&
        isForbiddenMove(sim.board, posOf(fives[0]).x, posOf(fives[0]).y).forbidden
      if (fives.length < 2 && !forcedForbidden)
        errors.push('solution 收尾非雙威脅/逼禁手（守方一手可解）')
    }
  }
  return { ok: errors.length === 0, errors, dMin }
}
