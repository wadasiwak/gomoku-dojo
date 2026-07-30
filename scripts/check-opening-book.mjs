// 開局書全量驗證（npm run check 的一部分）：
//   - 結構：version/source/entries 齊全、key 與 move 格式合法、key 為 canonical
//     （再歸一一次必須不動——保證查表能命中自己）。
//   - 合法性雙驗（本站引擎重驗 Rapfi 建議手）：check-book-lib.mjs 的四項
//     （空點／黑不踩禁手／不送對手成五／對手有殺必須是防守解）。
//   - 覆蓋率統計：26 開局前三手覆蓋、手數分布、最深覆蓋、來源參數。
//
//   node scripts/check-opening-book.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { OPENINGS, openingMoves } from '../src/content/openings.ts'
import { canonicalMovesKey } from '../src/engine/symmetry.ts'
import { validateEntry } from './check-book-lib.mjs'
import { strToMove } from '../src/openings/lookup.ts'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const book = JSON.parse(readFileSync(path.join(ROOT, 'src', 'openings', 'book.json'), 'utf8'))

let failures = 0
const fail = (msg) => {
  failures++
  console.error(`✗ ${msg}`)
}

// ---- 結構 -------------------------------------------------------------------
if (book.version !== 1) fail(`version 不是 1：${book.version}`)
for (const f of ['engine', 'version', 'commit', 'thinkTimeMs'])
  if (!book.source?.[f]) fail(`source.${f} 缺漏`)
const entries = book.entries ?? {}
const keys = Object.keys(entries)
if (keys.length === 0) fail('entries 是空的')

// ---- 每筆驗證 ----------------------------------------------------------------
const byPly = new Map()
for (const key of keys) {
  // 空 key＝空盤（黑第 1 手天元）也是合法條目
  if (!/^([a-o][a-o])*$/.test(key)) {
    fail(`key 格式不合法：${key}`)
    continue
  }
  const e = entries[key]
  // depth 0＝定式手秒回（Rapfi 未輸出 INFO DEPTH，如空盤天元），合法
  if (!/^[a-o][a-o]$/.test(e.move) || !Number.isFinite(e.score) || !(e.depth >= 0)) {
    fail(`${key}: 條目欄位不合法 ${JSON.stringify(e)}`)
    continue
  }
  const moves = []
  for (let i = 0; i < key.length; i += 2) moves.push(strToMove(key.slice(i, i + 2)))
  if (canonicalMovesKey(moves) !== key) {
    fail(`${key}: key 不是 canonical form（查表永遠打不中）`)
    continue
  }
  const v = validateEntry(moves, strToMove(e.move))
  if (!v.ok) fail(`${key} → ${e.move}: 合法性驗證不過（${v.reason}）`)
  byPly.set(moves.length, (byPly.get(moves.length) ?? 0) + 1)
}

// ---- 覆蓋率 ------------------------------------------------------------------
let covered = 0
for (const o of OPENINGS) {
  if (entries[canonicalMovesKey(openingMoves(o))]) covered++
  else fail(`開局 ${o.id} 的前三手局面沒有白 4 書值`)
}
const plies = [...byPly.keys()].sort((a, z) => a - z)

console.log('=== 開局書檢查 ===')
console.log(
  `來源：${book.source.engine} ${book.source.version}（${String(book.source.commit).slice(0, 7)}）`,
  `思考 ${book.source.thinkTimeMs}ms/局面`,
)
console.log(`條目：${keys.length} 筆；26 開局白 4 覆蓋 ${covered}/26`)
console.log(
  `手數分布：${plies.map((p) => `${p}手×${byPly.get(p)}`).join('、')}（最深 ${plies.at(-1) ?? 0} 手局面）`,
)

if (failures > 0) {
  console.error(`\n✗ ${failures} 項未通過`)
  process.exit(1)
}
console.log('✓ 全數通過（結構＋canonical key＋全量合法性雙驗＋26 開局覆蓋）')
