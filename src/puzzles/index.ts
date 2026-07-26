// 題庫存取：puzzles.json 由 scripts/gen-puzzles.mjs 離線產生（seed 固定、
// 每題經 solveVcf 驗證且最小深度已證明），scripts/check-puzzles.mjs 可全量重驗。
import data from './puzzles.json'
import type { Rule, Pos } from '../engine/types.ts'

export type Difficulty = 'easy' | 'medium' | 'hard'

export interface Puzzle {
  id: string
  rule: Rule
  attacker: 'black' | 'white'
  /** 到達題目局面的完整棋譜（record.ts 格式），重播即得合法盤面。 */
  record: string
  stones: number
  /** 最小 VCF 深度（攻方手數，generator 逐層證明）。 */
  vcfDepth: number
  difficulty: Difficulty
  /** 主變化（攻守交替，攻方先）。 */
  solution: Pos[]
  verify: { minDepthProven: boolean; maxNodesPerCall: number; solver: string }
}

export const DIFF_LABEL: Record<Difficulty, string> = {
  easy: '初級',
  medium: '中級',
  hard: '高級',
}

export const PUZZLES: Puzzle[] = data.puzzles as Puzzle[]

export const getPuzzle = (id: string): Puzzle | undefined =>
  PUZZLES.find((p) => p.id === id)

export function nextPuzzleId(afterId: string): string | null {
  const i = PUZZLES.findIndex((p) => p.id === afterId)
  if (i < 0 || i + 1 >= PUZZLES.length) return null
  return PUZZLES[i + 1].id
}
