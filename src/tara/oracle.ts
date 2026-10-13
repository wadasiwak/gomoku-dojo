// 瀏覽器端 Oracle：把 RapfiClient 包成 tara/ai.ts 要的評估器介面，
// 以及 Rapfi 對弈的強度分級與用時分配。
import { getRapfi } from '../analysis/rapfi.ts'
import { evalTextToScore, type ThinkLimits } from '../analysis/protocol.ts'
import type { Pos } from '../engine/types.ts'
import type { Oracle } from './ai.ts'

export function rapfiOracle(limits: ThinkLimits = {}): Oracle {
  return {
    async evaluate(moves, timeMs) {
      const r = await getRapfi().analyze({ moves }, 'renju', timeMs, limits)
      return evalTextToScore(r.evalText)
    },
    async nbest(moves, n, timeMs) {
      const r = await getRapfi().analyzeNBest({ moves }, 'renju', n, timeMs, limits)
      return r.lines.map((l) => ({ move: l.move, score: evalTextToScore(l.evalText) }))
    },
  }
}

/** Rapfi 對弈強度。深度上限照 WebRapfi 實測經驗（10~15 接近人類），
 *  校準要靠國手實戰回饋——標籤只描述設定，不宣稱棋力段位。 */
export type RapfiStrength = 'max' | 'd14' | 'd10' | 'd6'

export const RAPFI_STRENGTHS: Record<RapfiStrength, { label: string; limits: ThinkLimits }> = {
  max: { label: '全力（不限深度）', limits: {} },
  d14: { label: '強（深度上限 14）', limits: { maxDepth: 14 } },
  d10: { label: '中（深度上限 10）', limits: { maxDepth: 10 } },
  d6: { label: '練習（深度上限 6）', limits: { maxDepth: 6 } },
}

/** 不計時對局的每手思考時間。 */
export const UNTIMED_MOVE_MS = 5000

/** 計時對局的每手用時分配：剩餘時間的 1/25 加大部分加秒，
 *  夾在 0.4s～30s 之間（加秒制下 AI 不會超時，也不會一手花掉大半）。 */
export function moveBudgetMs(remainingMs: number, incrementMs: number): number {
  const raw = remainingMs / 25 + incrementMs * 0.8
  return Math.round(Math.min(30_000, Math.max(400, Math.min(raw, remainingMs * 0.5))))
}

/** 時制選項（名人賽資格賽＝30 分＋每手 30 秒）。 */
export type TimeControl = 'none' | '30+30' | '60+30' | '10+10' | '5+5'

export const TIME_CONTROLS: Record<TimeControl, { label: string; baseMs: number; incMs: number } | null> = {
  none: null,
  '30+30': { label: '30 分＋每手 30 秒（名人賽資格賽）', baseMs: 30 * 60_000, incMs: 30_000 },
  '60+30': { label: '60 分＋每手 30 秒（循環圈）', baseMs: 60 * 60_000, incMs: 30_000 },
  '10+10': { label: '10 分＋每手 10 秒（快棋練習）', baseMs: 10 * 60_000, incMs: 10_000 },
  '5+5': { label: '5 分＋每手 5 秒（超快棋）', baseMs: 5 * 60_000, incMs: 5_000 },
}

export const posEq = (a: Pos, b: Pos): boolean => a.x === b.x && a.y === b.y
