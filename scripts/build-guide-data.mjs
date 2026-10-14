// 《漱星閣開局指南》打點資料 → 道場「打點複習」頁（#/guide）用的 JSON。
//   node scripts/parse-opening-guide.mjs guide.html > scratch/white4/guide.json
//   node scripts/build-guide-data.mjs        # → src/guide/guide-data.json
// 資料經名人同意收錄（國手 2026-10-14 轉達：名人許願要這個功能）。
// 欄位精簡：棋盤照 PDF 原方位（raw）；變化名轉繁體；註記保留原文（頁面端解析）。
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const guide = JSON.parse(readFileSync(path.join(ROOT, 'scratch', 'white4', 'guide.json'), 'utf8'))
const T = {
  预: '預', 险: '險', 缅: '緬', 绝: '絕', 怀: '懷', 计: '計', 贪: '貪', 结: '結', 赌: '賭', 应: '應',
  谢: '謝',
}
const trad = (s) => [...s].map((c) => T[c] ?? c).join('')
const data = guide.map((v) => ({
  page: v.page,
  opening: v.opening,
  name: trad(v.variation),
  notes: v.notes,
  win: v.winCount,
  viable: v.viable,
  hard: v.hard,
  stones: v.raw.stones.map((p) => [p.x, p.y]),
  // [x, y, kind, rank, prime]
  labels: v.raw.labels.map((l) => [l.pos.x, l.pos.y, l.kind, l.rank, l.prime ? 1 : 0]),
}))
const out = path.join(ROOT, 'src', 'guide', 'guide-data.json')
writeFileSync(out, JSON.stringify(data))
console.log(`${out}（${data.length} 題，${(JSON.stringify(data).length / 1024).toFixed(0)} KB）`)
