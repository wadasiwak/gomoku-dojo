// Rapfi 建議路線（主變化）的「跟著走」判定。
//
// 國手回饋（2026-10-13）：擺譜跑出 Rapfi 建議後，照建議下了第一顆，建議就消失了。
// 改成：分析時記住「當時盤面＋主變化」（錨點），之後任何時候都拿目前盤面比對——
// 目前盤面＝錨點盤面＋主變化前 k 手（黑白交替、從當時待下方起）→ 還在路線上，
// 棋盤繼續畫剩下的路線；否則（走了別的、悔過頭）＝已偏離，路線收掉。
// 純推導、不靠事件：擺子、試下、悔棋、重播前後跳都同一套判定。
//
// 例：錨點時輪黑，主變化 H8 I9 J10。下了 H8（黑）→ k=1，剩 I9（白）J10（黑）；
//     再下 G7 → 盤面多出一顆不在路線上的子 → 偏離（null）。
import { EMPTY, opponent, idx, type Color, type Pos } from '../engine/types.ts'

export interface PvAnchor {
  /** 分析當下的盤面快照。 */
  root: Uint8Array
  /** 主變化（第一手＝建議手）。 */
  line: Pos[]
  /** 主變化第一手的顏色（＝分析當下的待下方）。 */
  color: Color
  /** 分析當下的局面簽名（傳給 RapfiPanel，跟著走時維持不變 → 結果不被清掉）。 */
  key: string
}

/** 目前盤面沿主變化走了幾手；偏離回 null。 */
export function pvProgress(anchor: PvAnchor, board: ArrayLike<number>): number | null {
  const diffs: number[] = []
  for (let i = 0; i < anchor.root.length; i++) if (board[i] !== anchor.root[i]) diffs.push(i)
  const k = diffs.length
  if (k > anchor.line.length) return null
  let color = anchor.color
  for (let i = 0; i < k; i++) {
    const p = anchor.line[i]
    const c = idx(p.x, p.y)
    if (anchor.root[c] !== EMPTY || board[c] !== color) return null
    color = opponent(color)
  }
  return k
}

/** 還沒走的路線（給棋盤畫半透明編號子）：每手帶顏色。偏離或走完回空陣列。 */
export function remainingPv(
  anchor: PvAnchor | null,
  board: ArrayLike<number>,
): { pos: Pos; color: Color }[] {
  if (!anchor) return []
  const k = pvProgress(anchor, board)
  if (k === null) return []
  let color = anchor.color
  const out: { pos: Pos; color: Color }[] = []
  anchor.line.forEach((pos, i) => {
    if (i >= k) out.push({ pos, color })
    color = opponent(color)
  })
  return out
}
