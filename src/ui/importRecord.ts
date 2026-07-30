// 匯入棋譜解析器：把用戶貼上的文字轉成嚴格驗證過的 GameRecord。
//
// 支援兩種輸入：
// 1. 本站棋譜（`r1:`/`g1:`/`r2:`，大小寫與前後空白容錯）——規則自帶，
//    走 parseRecord 嚴格驗證；r2 另過 rifStateFromRecord 規約一致性檢查。
// 2. 通用座標序列（如 `h8 i9 g9` 或 `H8,I9,G9`）——容忍大小寫、逗號／頓號／
//    分號／空白／換行分隔；座標＝字母列（a–o）＋數字行（1–15，行 1 在最下），
//    與 coordName（coords.ts）同一慣例。規則由呼叫端指定（UI 選單）。
//
// 兩路都逐手照 Game 規則重播驗證：重複落子／對局已分勝負後仍有著手 → 報
// 「第幾手壞掉」的行內錯誤。黑踩禁手照規則「落子成立、立即判負」——禁手手
// 本身合法可匯入（作為終局手），但其後不得再有著手。
import { Game } from '../engine/game.ts'
import { parseRecord, serializeRecord, type GameRecord } from '../engine/record.ts'
import { rifStateFromRecord } from '../rif/protocol.ts'
import { SIZE, type Pos, type Rule } from '../engine/types.ts'
import { coordName } from './coords.ts'

export type ImportResult =
  | { ok: true; record: GameRecord; serialized: string }
  | { ok: false; error: string }

/** 通用座標 token：字母列 a–o ＋ 行號 1–15。 */
const TOKEN_RE = /^([a-o])(1[0-5]|[1-9])$/

/** 逐手照 Game 規則重播；非法回「第幾手壞掉」的錯誤訊息，合法回 null。 */
function replayError(rec: GameRecord): string | null {
  const g = new Game(rec.rule)
  for (let i = 0; i < rec.moves.length; i++) {
    const m = rec.moves[i]
    if (g.result.kind !== 'ongoing')
      return `第 ${i + 1} 手 ${coordName(m)} 非法：對局已在前一手分出勝負，之後不應再有著手`
    if (!g.play(m.x, m.y)) return `第 ${i + 1} 手 ${coordName(m)} 非法：該點已有棋子`
  }
  return null
}

/**
 * 解析匯入文字。`rule` 只用於通用座標序列（本站棋譜自帶規則）。
 * 回傳的 serialized 是正規化棋譜字串，可直接進 `#/replay/`、`#/study/`。
 */
export function parseImport(text: string, rule: Rule = 'renju'): ImportResult {
  const t = text.trim()
  if (!t) return { ok: false, error: '請先貼上棋譜或座標序列' }

  // ---- 本站棋譜格式 ----
  if (/^[rg][12]:/i.test(t)) {
    const rec = parseRecord(t.toLowerCase())
    if (!rec)
      return {
        ok: false,
        error: '本站棋譜格式無效（格式錯誤、座標越界、重複落子或規約事件不合法）',
      }
    if (rec.rif && !rifStateFromRecord(rec))
      return { ok: false, error: '規約棋譜（r2）驗證失敗：開局珠型／換邊／兩打與手順不一致' }
    const err = replayError(rec)
    if (err) return { ok: false, error: err }
    return { ok: true, record: rec, serialized: serializeRecord(rec) }
  }

  // ---- 通用座標序列 ----
  const tokens = t
    .toLowerCase()
    .split(/[\s,;，、；]+/u)
    .filter(Boolean)
  if (tokens.length === 0) return { ok: false, error: '請先貼上棋譜或座標序列' }
  const moves: Pos[] = []
  for (let i = 0; i < tokens.length; i++) {
    const m = TOKEN_RE.exec(tokens[i])
    if (!m)
      return {
        ok: false,
        error: `第 ${i + 1} 手「${tokens[i]}」無法解析：座標格式為字母列＋數字行（如 h8，行 1 在最下）`,
      }
    moves.push({ x: m[1].charCodeAt(0) - 97, y: SIZE - Number(m[2]) })
  }
  const rec: GameRecord = { rule, moves }
  const err = replayError(rec)
  if (err) return { ok: false, error: err }
  return { ok: true, record: rec, serialized: serializeRecord(rec) }
}
