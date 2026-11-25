// 提和（對弈頁／名人賽特訓共用）：人方在自己手番提和，AI 看局勢決定接不接受。
//
// 規則（2026-11-25 使用者建議）：
//   1. 下滿 DRAW_MIN_MOVES 手才能提和（太早提和沒意義）。
//   2. AI 評估「自己」的局勢：沒有明顯優勢就接受；明顯優勢才拒絕。
//      AI 落後時也接受——要不要在優勢下求和是人方自己的選擇。
//   3. 被拒絕後要再下 DRAW_RETRY_MOVES 手才能再提（防連按）。
//
// 實例走一遍（Rapfi 尺度，門檻 150）：
//   第 58 手提和           → 按鈕不可按（未滿 60 手）
//   第 64 手，AI 評分 +40  → 接受（沒很優）
//   第 64 手，AI 評分 +420 → 拒絕；第 74 手起才能再提
//   第 80 手，AI 評分 −300 → 接受（AI 落後，樂於和棋）
//   評分拿不到（null）     → 拒絕（不知道局勢就不亂和）

/** 下滿幾手才能提和。 */
export const DRAW_MIN_MOVES = 60
/** 被拒絕後要再下幾手才能再提。 */
export const DRAW_RETRY_MOVES = 10
/** AI 評估提和時的 Rapfi 思考時間。 */
export const DRAW_THINK_MS = 2000

/** 「AI 明顯優勢」門檻（AI 視角分數達到就拒絕）。兩種引擎分數尺度不同，分開定：
 *  - Rapfi：原生 EVAL，150 約等於勝率 68%。
 *  - 本站引擎（難度 1–4）：棋形權重和，5000 約等於「多一個對手沒擋的活三」的三分之一，
 *    即已有實質攻勢。 */
export const DRAW_REFUSE_RAPFI = 150
export const DRAW_REFUSE_ENGINE = 5000

/** 現在能不能提和。lastRefusedAt＝上次被拒絕時的手數（沒被拒絕過＝null）。 */
export function canOfferDraw(moveCount: number, lastRefusedAt: number | null): boolean {
  if (moveCount < DRAW_MIN_MOVES) return false
  if (lastRefusedAt !== null && moveCount < lastRefusedAt + DRAW_RETRY_MOVES) return false
  return true
}

/** AI 接不接受提和。aiScore＝AI 視角的局勢分數；refuseAt＝該引擎的「明顯優勢」門檻。 */
export function aiAcceptsDraw(aiScore: number | null, refuseAt: number): boolean {
  if (aiScore === null) return false
  return aiScore < refuseAt
}
