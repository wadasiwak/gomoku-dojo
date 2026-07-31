// 開局書存取：book.json 由 scripts/gen-opening-book.mjs 以 Rapfi 離線深算產生
// （每筆經本站引擎合法性雙驗；scripts/check-opening-book.mjs 可全量重驗）。
// 查表核心（8 對稱歸一＋建議手反變換）在 lookup.ts，此檔只綁定資料與便利 API。
import data from './book.json'
import { lookupIn, type BookEntry, type BookHit } from './lookup.ts'
import type { Color, Pos, Rule } from '../engine/types.ts'
import { BLACK, WHITE } from '../engine/types.ts'

export type { BookHit } from './lookup.ts'

interface BookData {
  version: number
  source: { engine: string; version: string; commit: string; thinkTimeMs: number }
  entries: Record<string, BookEntry>
}

const BOOK = data as unknown as BookData

export const BOOK_SOURCE = BOOK.source
export const BOOK_SIZE = Object.keys(BOOK.entries).length
/** 全部書條目（隱藏頁 #/book 檢視用；一般查表請走 bookLookup）。 */
export const BOOK_ENTRIES = BOOK.entries

/** 查書：手順（任意方位）→ 建議手（已反變換回實際盤方位）＋行棋方視角分數。
 *  書以連珠規則產生，僅在 renju 對局查。未命中回 null。 */
export function bookLookup(moves: readonly Pos[]): BookHit | null {
  return lookupIn(BOOK.entries, moves)
}

/** 規約兩打/擇打評值：前四手＋候選第 5 手 → 黑方視角書值（書存的是落子後
 *  白方手番的白視角分數，黑視角＝取負）。書未命中回 null。 */
export function bookOfferValue(moves4: readonly Pos[], candidate: Pos): number | null {
  const hit = lookupIn(BOOK.entries, [...moves4, candidate])
  return hit ? -hit.score : null
}

/**
 * AI 手番查書（含紀律檢查閘門）：
 *   - 書僅涵蓋 renju（規約與自由連珠）；gomoku 一律不查。
 *   - 手順奇偶必須輪到 aiColor（防呆）。
 *   - 命中後先問「對手是否有殺」（呼叫端注入 VCF 檢查，走既有 Worker）——
 *     對手有殺就不走書，回退搜索讓防守模式接手（防守紀律優先於書）。
 * 未命中／被閘門擋下回 null，呼叫端回退正常搜索。
 */
export async function bookMoveWithDiscipline(
  moves: readonly Pos[],
  rule: Rule,
  aiColor: Color,
  foeHasVcf: () => Promise<boolean>,
): Promise<BookHit | null> {
  if (rule !== 'renju') return null
  const toMove = moves.length % 2 === 0 ? BLACK : WHITE
  if (toMove !== aiColor) return null
  const hit = bookLookup(moves)
  if (!hit) return null
  if (await foeHasVcf()) return null
  return hit
}
