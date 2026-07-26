// 棋譜：著手序列的記錄 / 重播 / 序列化（之後 URL 分享用）。
//
// 序列化格式（v1）：`<rule 代碼><版本>:<著手串>`
//   - rule 代碼：r = renju、g = gomoku
//   - 版本：1
//   - 著手串：每手 2 字元，x、y 各以 'a'..'o' 表示 0..14，依落子順序連接。
//     黑白由手順推得（第 1 手黑、第 2 手白…），不另編碼。
//   例：`r1:hhhgii` = renju，黑 (7,7)、白 (7,6)、黑 (8,8)。
import { SIZE, type Pos, type Rule } from './types.ts'

export interface GameRecord {
  rule: Rule
  moves: Pos[]
}

const A = 'a'.charCodeAt(0)

export function serializeRecord(rec: GameRecord): string {
  const head = rec.rule === 'renju' ? 'r1' : 'g1'
  const body = rec.moves
    .map((m) => String.fromCharCode(A + m.x) + String.fromCharCode(A + m.y))
    .join('')
  return `${head}:${body}`
}

/** 嚴格驗證解析：格式/座標範圍/重複落子不合法一律回 null（分享參數不可信）。 */
export function parseRecord(s: string): GameRecord | null {
  const m = /^([rg])1:((?:[a-o][a-o])*)$/.exec(s)
  if (!m) return null
  const rule: Rule = m[1] === 'r' ? 'renju' : 'gomoku'
  const moves: Pos[] = []
  const seen = new Set<number>()
  for (let i = 0; i < m[2].length; i += 2) {
    const x = m[2].charCodeAt(i) - A
    const y = m[2].charCodeAt(i + 1) - A
    const key = y * SIZE + x
    if (seen.has(key)) return null // 重複落子 → 非法棋譜
    seen.add(key)
    moves.push({ x, y })
  }
  return { rule, moves }
}
