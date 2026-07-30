// 棋譜：著手序列的記錄 / 重播 / 序列化（URL 分享用）。
//
// 序列化格式（v1）：`<rule 代碼><版本>:<著手串>`
//   - rule 代碼：r = renju、g = gomoku
//   - 版本：1
//   - 著手串：每手 2 字元，x、y 各以 'a'..'o' 表示 0..14，依落子順序連接。
//     黑白由手順推得（第 1 手黑、第 2 手白…），不另編碼。
//   例：`r1:hhhgii` = renju，黑 (7,7)、白 (7,6)、黑 (8,8)。
//
// 序列化格式（v2，RIF 正式規約對弈；規則固定 renju）：`r2:<著手串>[:<事件串>]`
//   - 事件串依序由三段組成，各段可省略但有相依規則：
//       o<d|i><1-13>  開局珠型 id（如 od4＝花月、oi13＝彗星）
//       s<0|1>        暫白是否換邊
//       t<xy><xy>     黑方兩打候選 A、B 兩點（各 2 字元；成立的第 5 手必為
//                     其中之一，另一點即棄點）
//   - 相依（嚴格驗證，殘局中途存檔也要自洽）：
//       著手 ≥3 → 必有 o；≥4 → 必有 s；≥5 → 必有 t 且第 5 手 ∈ 兩打
//   例：`r2:hhigiijggi:oi7s0tgijj` = 浦月、不換邊、兩打 (6,8)/(9,9) 擇 (6,8)。
//   （珠型與手順是否真的一致等深度驗證在 rif/protocol.ts 的 rifStateFromRecord。）
import { SIZE, type Pos, type Rule } from './types.ts'

export interface RifEvents {
  /** 26 珠型 id（'d1'..'d13' / 'i1'..'i13'）。 */
  openingId?: string
  /** 暫白是否換邊。 */
  swapped?: boolean
  /** 黑方兩打候選（A、B 依提出順序）。 */
  offers?: [Pos, Pos]
}

export interface GameRecord {
  rule: Rule
  moves: Pos[]
  /** 規約事件（僅 v2；存在即代表 RIF 正式規約對局）。 */
  rif?: RifEvents
}

const A = 'a'.charCodeAt(0)

const pt = (p: Pos): string => String.fromCharCode(A + p.x) + String.fromCharCode(A + p.y)

export function serializeRecord(rec: GameRecord): string {
  const body = rec.moves.map(pt).join('')
  if (rec.rif) {
    // v2 只定義於連珠規則（RIF 規約）
    let ev = ''
    if (rec.rif.openingId) ev += `o${rec.rif.openingId}`
    if (rec.rif.swapped !== undefined) ev += `s${rec.rif.swapped ? 1 : 0}`
    if (rec.rif.offers) ev += `t${pt(rec.rif.offers[0])}${pt(rec.rif.offers[1])}`
    return `r2:${body}${ev ? `:${ev}` : ''}`
  }
  const head = rec.rule === 'renju' ? 'r1' : 'g1'
  return `${head}:${body}`
}

/** 解析著手串（已通過格式 regex）：重複落子回 null。 */
function parseMoves(s: string): Pos[] | null {
  const moves: Pos[] = []
  const seen = new Set<number>()
  for (let i = 0; i < s.length; i += 2) {
    const x = s.charCodeAt(i) - A
    const y = s.charCodeAt(i + 1) - A
    const key = y * SIZE + x
    if (seen.has(key)) return null // 重複落子 → 非法棋譜
    seen.add(key)
    moves.push({ x, y })
  }
  return moves
}

const V2_EVENTS = /^(?:o([di])(1[0-3]|[1-9]))?(?:s([01]))?(?:t([a-o]{2})([a-o]{2}))?$/

/** 嚴格驗證解析：格式/座標範圍/重複落子/規約事件相依不合法一律回 null
 *  （分享參數不可信）。 */
export function parseRecord(s: string): GameRecord | null {
  // ---- v1 ----
  const m1 = /^([rg])1:((?:[a-o][a-o])*)$/.exec(s)
  if (m1) {
    const moves = parseMoves(m1[2])
    if (!moves) return null
    return { rule: m1[1] === 'r' ? 'renju' : 'gomoku', moves }
  }
  // ---- v2 ----
  if (!s.startsWith('r2:')) return null
  const rest = s.slice(3)
  const ci = rest.indexOf(':')
  const body = ci < 0 ? rest : rest.slice(0, ci)
  const evStr = ci < 0 ? null : rest.slice(ci + 1)
  if (!/^(?:[a-o][a-o])*$/.test(body)) return null
  if (evStr !== null && evStr === '') return null // 空事件串（多餘冒號）
  const moves = parseMoves(body)
  if (!moves) return null

  const rif: RifEvents = {}
  if (evStr !== null) {
    const m2 = V2_EVENTS.exec(evStr)
    if (!m2) return null
    if (m2[1]) rif.openingId = `${m2[1]}${m2[2]}`
    if (m2[3]) rif.swapped = m2[3] === '1'
    if (m2[4]) {
      const a = parseMoves(m2[4])![0]
      const b = parseMoves(m2[5])![0]
      rif.offers = [a, b]
    }
  }
  // 相依驗證：事件必須跟得上手數（中途存檔也要自洽）。
  const n = moves.length
  if (n >= 3 && !rif.openingId) return null
  if (n < 3 && rif.openingId) return null
  if (n >= 4 && rif.swapped === undefined) return null
  if (n < 3 && rif.swapped !== undefined) return null
  if (n >= 5 && !rif.offers) return null
  if (n < 4 && rif.offers) return null
  if (rif.offers) {
    const [a, b] = rif.offers
    if (a.x === b.x && a.y === b.y) return null // 兩打同點
    // 兩打不可落在前四手已占的點上
    for (const mv of moves.slice(0, 4))
      if ((mv.x === a.x && mv.y === a.y) || (mv.x === b.x && mv.y === b.y)) return null
    // 第 5 手必須是兩打其中之一
    if (n >= 5) {
      const c = moves[4]
      if (!((c.x === a.x && c.y === a.y) || (c.x === b.x && c.y === b.y))) return null
    }
  }
  return { rule: 'renju', moves, rif }
}
