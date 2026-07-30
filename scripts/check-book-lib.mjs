// 開局書合法性驗證（generator 與 check-opening-book.mjs 共用）。
// 對每筆 {手順, 建議手} 用**本站引擎**獨立重驗（與 Rapfi 互為雙驗）：
//   1. 建議手在盤內且為空點；
//   2. 行棋方是黑 → 不踩禁手（isForbiddenMove）；
//   3. 建議手若直接獲勝 → 過；否則落子後對手不得有一手成五點
//      （「不送對手成五」——除非落子前對手已有 ≥2 個五點，單手救不完，
//      該局面本就不該進書，一樣判 fail 打回）;
//   4. 落子前對手若有 VCF（小預算可證）→ 落子後同預算必須解不出
//      （防守解要求——書手不可無視對手的殺）。
import { BLACK, WHITE, EMPTY, SIZE, idx } from '../src/engine/types.ts'
import { isForbiddenMove } from '../src/engine/forbidden.ts'
import { isWinningMove } from '../src/engine/rules.ts'
import { findFivePoints, solveVcf } from '../src/engine/vcf.ts'

export const VCF_BUDGET = { maxDepth: 10, maxNodes: 30000, timeLimitMs: 2000 }

/** 手順（黑先交替）→ 盤面。手順自身若不合法（占用/出界）回 null。 */
export function boardOfMoves(moves) {
  const b = new Uint8Array(SIZE * SIZE)
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i]
    if (m.x < 0 || m.x >= SIZE || m.y < 0 || m.y >= SIZE) return null
    const c = idx(m.x, m.y)
    if (b[c] !== EMPTY) return null
    b[c] = i % 2 === 0 ? BLACK : WHITE
  }
  return b
}

/**
 * 驗一筆書資料。moves＝到達局面的手順（任意方位），move＝建議手（同方位）。
 * 回 { ok: true } 或 { ok: false, reason }。
 */
export function validateEntry(moves, move) {
  const b = boardOfMoves(moves)
  if (!b) return { ok: false, reason: 'bad-moves' }
  const mover = moves.length % 2 === 0 ? BLACK : WHITE
  const foe = mover === BLACK ? WHITE : BLACK

  if (move.x < 0 || move.x >= SIZE || move.y < 0 || move.y >= SIZE)
    return { ok: false, reason: 'off-board' }
  if (b[idx(move.x, move.y)] !== EMPTY) return { ok: false, reason: 'occupied' }
  if (mover === BLACK && isForbiddenMove(b, move.x, move.y).forbidden)
    return { ok: false, reason: 'forbidden' }

  // 落子前對手的殺（小預算）——書手必須是防守解。
  const foeVcfBefore = solveVcf(b, foe, 'renju', VCF_BUDGET)

  b[idx(move.x, move.y)] = mover
  try {
    if (isWinningMove(b, move.x, move.y, mover, 'renju')) return { ok: true }
    if (findFivePoints(b, foe, 'renju').length > 0) return { ok: false, reason: 'gives-five' }
    if (foeVcfBefore.found) {
      const after = solveVcf(b, foe, 'renju', VCF_BUDGET)
      if (after.found) return { ok: false, reason: 'keeps-foe-vcf' }
    }
  } finally {
    b[idx(move.x, move.y)] = EMPTY
  }
  return { ok: true }
}
