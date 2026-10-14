// 名人林書玄整理的《玄》棋譜庫（RenLib .lib）→ 加密檔 public/xuan/xuan.vault（只有加密檔進 repo）：
//   1. 看譜頁（#/lib）用的 .lib：去掉實戰對局的棋手資訊註解，其餘原樣
//   2. 打點複習（#/guide）「玄」資料來源：26 開局每個有評等的白 4
//   兩份一起 gzip＋AES-GCM 加密（格式見 src/renlib/vault.ts），密碼由環境變數給、不進 repo。
//   明文另寫 scratch/xuan/xuan-data.json（gitignored）給單元測試／e2e 用。
// 用法：XUAN_PASSWORD=… node scripts/build-xuan.mjs [~/Downloads/玄.TXT]
//
// 玄的評等（庫根節點註解）：A 黑必勝、B 黑大優 80+、C 黑優 60-80、D 均勢 40-60、E 白優 40-20、
// F 白大優 20-、G 白必勝；後接名次（A1、A2…），! 唯一／僅存、? 沒驗證過。
// 對到打點複習的標籤類別：A→win（A?→winq）、B～E→bal（評價由 grades 決定）、F→near、G→lose。
// 例：寒預（d1，白 4 在 8 路）→ A1～A6 六個黑必勝、D 兩個均勢、F 一個、G 二十一個。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { parseRenlib, writeRenlib, children, isMove, posToXY } from '../src/renlib/renlib.ts'
import { findOpeningByMoves, OPENINGS } from '../src/content/openings.ts'
import { canonicalMovesKey } from '../src/engine/symmetry.ts'
import { openXuan, sealXuan } from '../src/renlib/vault.ts'

const password = process.env.XUAN_PASSWORD
if (!password) throw new Error('請用環境變數 XUAN_PASSWORD 給玄庫密碼')

const src = process.argv[2] ?? `${homedir()}/Downloads/玄.TXT`
const buf = new Uint8Array(readFileSync(src))

// ---- 1. 看譜用 lib：去掉棋手資訊 ----
// 實戰對局註解（「黑：吳鏑 五段\n白：…」「Black: Nikonov 1」「Meritee - Sushkov, 1:0」）不上網站；
// 研究註解（「騙」「g7唯一」「=24-H5」轉換手順）保留。
const PLAYER_RE = /black\s*:|white\s*:|黑\s*[:：]|白\s*[:：]|\d\s*:\s*\d|\bvs\b|黑吳鏑|黑 岡部|\d+\s*mins/i
const raw = parseRenlib(buf, 'raw')
const big5 = new TextDecoder('big5')
const asText = (s) => big5.decode(Uint8Array.from([...s].map((c) => c.charCodeAt(0))))
let dropped = 0
const out = writeRenlib(raw, (c) => {
  const keep = !PLAYER_RE.test(asText(c))
  if (!keep) dropped++
  return keep
})
console.log(`lib：${raw.size} 節點，去掉 ${dropped} 則棋手資訊註解，${out.length} bytes`)

// ---- 2. 打點複習資料 ----
const t = parseRenlib(buf)
const GRADE_RE = /^([A-G])(\d*)([!?']*)$/
const KIND = { A: 'win', B: 'bal', C: 'bal', D: 'bal', E: 'bal', F: 'near', G: 'lose' }

// 漱星閣指南已有的變化沿用其名稱（同一局面，對稱等價即算）
const guide = JSON.parse(readFileSync('src/guide/guide-data.json', 'utf8'))
const toPos = ([x, y]) => ({ x, y })
const guideName = new Map(guide.map((g) => [canonicalMovesKey(g.stones.map(toPos)), g.name]))

const COL = 'ABCDEFGHIJKLMNO'
const nm = (p) => `${COL[p.x]}${15 - p.y}`
// 進度以 id 為鍵：用局面雜湊（庫更新、題目增減時舊紀錄不錯位）
const fnv = (s) => {
  let h = 0x811c9dc5
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0
  return 100000 + (h % 900000000)
}

const found = new Map() // 局面 key → item
const walk = (n, moves) => {
  for (const c of children(t, n)) {
    if (!isMove(t, c)) continue
    const m = [...moves, posToXY(t.pos[c])]
    if (m.length < 4) walk(c, m)
    else gather(c, m)
  }
}
function gather(node, moves) {
  const op = findOpeningByMoves(moves.slice(0, 3))
  if (!op) return
  const labels = []
  const grades = []
  let auto = 100
  for (const c of children(t, node)) {
    const g = GRADE_RE.exec(t.text.get(c) ?? '')
    if (!g) continue
    const p = posToXY(t.pos[c])
    if (!p) continue
    const kind = g[1] === 'A' && g[3].includes('?') ? 'winq' : KIND[g[1]]
    labels.push([p.x, p.y, kind, g[2] ? +g[2] : auto++, 0])
    grades.push(g[0])
  }
  if (labels.length === 0) return
  const key = canonicalMovesKey(moves)
  const prev = found.get(key)
  if (prev && prev.labels.length >= labels.length) return
  const winRanks = new Set(grades.filter((s) => s[0] === 'A').map((s, k) => s.match(/\d+/)?.[0] ?? `u${k}`))
  found.set(key, {
    page: fnv(key),
    opening: op.id,
    name: guideName.get(key) ?? `白4 ${nm(moves[3])}`,
    notes: '',
    win: winRanks.size,
    viable: winRanks.size < 10,
    hard: grades.some((s) => s.includes('?')),
    stones: moves.map((p) => [p.x, p.y]),
    labels,
    grades,
    src: 'xuan',
  })
}
walk(0, [])

const order = new Map(OPENINGS.map((o, k) => [o.id, k]))
const items = [...found.values()].sort((a, b) => order.get(a.opening) - order.get(b.opening))
if (new Set(items.map((v) => v.page)).size !== items.length) throw new Error('id 撞號')
mkdirSync('scratch/xuan', { recursive: true })
writeFileSync('scratch/xuan/xuan-data.json', JSON.stringify(items))
const named = items.filter((v) => !v.name.startsWith('白4 ')).length
console.log(`xuan-data.json：${items.length} 個白 4（${named} 個對得到漱星閣名稱），${OPENINGS.filter((o) => items.some((v) => v.opening === o.id)).length} 開局`)

// ---- 3. 加密封存＋立刻用同一密碼解開驗一次 ----
const vault = await sealXuan(out, items, password)
const back = await openXuan(vault, password)
if (back.bundle.lib.length !== out.length || back.bundle.items.length !== items.length) throw new Error('加密後解不回原資料')
mkdirSync('public/xuan', { recursive: true })
writeFileSync('public/xuan/xuan.vault', vault)
console.log(`xuan.vault：${vault.length} bytes（已驗證可解開）`)
