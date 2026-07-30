// AI 開局書 generator：以 Rapfi WASM（node 離線，載入法同 rapfi-smoke.mjs）深算
// 產生 src/openings/book.json。
//
// 覆蓋設計（固定展開順序，結果可重現）：
//   Phase A0  26 開局前三手局面（白 4 手番）——先全部算完，書早期就有全開局覆蓋。
//   Phase A   每開局：白 4 top-K 分支（快篩排序）×（黑五手兩打常見打點 top-M 深算
//             ＋主變化延伸 EXTEND 手）——兩打點的深算條目同時充當 offer 評值、
//             白擇打評值與 AI 白第 6 手書值。
//   Phase B   自由模式黑先：空盤（黑 1）→ [天元] 白 2 top 分支 → 各分支主變化延伸。
//
// key＝canonicalMovesKey（8 對稱歸一）；建議手以「把實際手順映成 canonical key 的
// 對稱 t」變換到 canonical 方位存檔（查表時反變換回來，見 src/openings/lookup.ts）。
//
// 斷點續跑（長跑鐵律）：每完成一筆即 append 到 scratch/opening-book/entries.jsonl；
// 快篩排序結果 append 到 cache.jsonl。重跑時兩者全量載回、已有 key/快篩直接跳過。
// 每 FLUSH_EVERY 筆與結束時重寫 book.json（sorted keys）。
//
// 合法性雙驗：每筆 Rapfi 建議手用本站引擎驗（scripts/check-book-lib.mjs：禁手／
// 不送對手成五／對手有殺則必須是防守解）。不過關 → 3 倍時間回爐重算一次，
// 仍不過 → 剔除並記 rejected.jsonl。
//
// 用法：
//   node scripts/gen-opening-book.mjs                      # 全量（預設參數）
//   node scripts/gen-opening-book.mjs --deep-ms 12000 --branch-ms 400 \
//        --w4 3 --b5 4 --extend 4 --openings d1,i7         # 參數化／部分重算
//   node scripts/gen-opening-book.mjs --recompute keys.txt --deep-ms 30000
//        # 回爐：對指定 canonical key 清單用更長時間重算（RIF DB 校驗回爐用）
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  buildBoardCommand,
  buildThinkSetup,
  movesToStones,
  parseEngineLine,
} from '../src/analysis/protocol.ts'
import { OPENINGS, openingMoves } from '../src/content/openings.ts'
import { SYMMETRIES, canonicalMovesKey } from '../src/engine/symmetry.ts'
import { BLACK, WHITE, EMPTY, SIZE, idx } from '../src/engine/types.ts'
import { isForbiddenMove } from '../src/engine/forbidden.ts'
import { lookupIn, moveToStr, strToMove } from '../src/openings/lookup.ts'
import { validateEntry, boardOfMoves } from './check-book-lib.mjs'

const require = createRequire(import.meta.url)
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const RAPFI_DIR = path.join(ROOT, 'public', 'rapfi') + path.sep
const OUT = path.join(ROOT, 'src', 'openings', 'book.json')
const SCRATCH = path.join(ROOT, 'scratch', 'opening-book')
const ENTRIES_LOG = path.join(SCRATCH, 'entries.jsonl')
const CACHE_LOG = path.join(SCRATCH, 'cache.jsonl')
const REJECTED_LOG = path.join(SCRATCH, 'rejected.jsonl')

const RAPFI_VERSION = '0.43.02'
const RAPFI_COMMIT = '3c94c2a976f24a0dd1c5517623e9ab6fffe66bd7'

// ---- 參數 -------------------------------------------------------------------
const args = process.argv.slice(2)
const argVal = (name, dflt) => {
  const i = args.indexOf(name)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : dflt
}
const DEEP_MS = Number(argVal('--deep-ms', 10000)) // 深算/局面（實戰 L4 為 4s 的 2.5 倍）
const BRANCH_MS = Number(argVal('--branch-ms', 400)) // 分支快篩/候選
const W4_BRANCHES = Number(argVal('--w4', 3)) // 每開局白 4 分支數
const B5_CANDS = Number(argVal('--b5', 4)) // 每分支黑五手打點深算數
const EXTEND = Number(argVal('--extend', 4)) // 規約結束後主變化延伸手數
const W2_BRANCHES = Number(argVal('--w2', 4)) // 自由模式白 2 分支數
const ONLY_OPENINGS = argVal('--openings', '')
  ? new Set(argVal('--openings', '').split(','))
  : null
const RECOMPUTE_FILE = argVal('--recompute', null)
const FLUSH_EVERY = 20

// ---- Rapfi 載入（同 rapfi-smoke.mjs 的 loadGlueAsCjs）-------------------------
function loadGlueAsCjs(file) {
  const mod = { exports: {} }
  const fn = new Function(
    'module',
    'exports',
    'require',
    '__dirname',
    '__filename',
    readFileSync(file, 'utf8'),
  )
  fn(mod, mod.exports, require, path.dirname(file), file)
  return mod.exports
}

const events = []
const Rapfi = loadGlueAsCjs(RAPFI_DIR + 'rapfi-single-simd128.js')
const engine = await Rapfi({
  locateFile: (url) => RAPFI_DIR + url,
  onReceiveStdout: (line) => events.push(parseEngineLine(line)),
  onReceiveStderr: () => {},
  onExit: () => {},
})
engine.sendCommand('START 15')

/** Rapfi EVAL 字串 → 數值（±M<n>＝殺，映射到 ±(30000-n)）。 */
function parseEval(text) {
  if (text == null) return 0
  const m = /^([+-])M(\d+)$/.exec(text)
  if (m) return (m[1] === '+' ? 1 : -1) * (30000 - Number(m[2]))
  const v = parseInt(text, 10)
  return Number.isFinite(v) ? v : 0
}

/** 對局面（手順、黑先）思考 ms 毫秒，回 {move, score, depth}（行棋方視角）。 */
function think(moves, ms) {
  const toMove = moves.length % 2 === 0 ? BLACK : WHITE
  events.length = 0
  for (const c of [...buildThinkSetup('renju', ms), buildBoardCommand(movesToStones(moves), toMove)])
    engine.sendCommand(c)
  let move = null
  let evalText = null
  let depth = 0
  for (const e of events) {
    if (e.kind === 'move') move = e.pos
    else if (e.kind === 'eval') evalText = e.text
    else if (e.kind === 'depth') depth = e.value
  }
  return move ? { move, score: parseEval(evalText), depth } : null
}

// ---- 進度檔載入（斷點續跑）----------------------------------------------------
mkdirSync(SCRATCH, { recursive: true })
const readJsonl = (file) => {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
}

/** entries：canonical key → BookEntry（move 為 canonical 方位 2 字元）。 */
const entries = {}
let loadedCount = 0
for (const row of readJsonl(ENTRIES_LOG)) {
  entries[row.key] = { move: row.move, score: row.score, depth: row.depth }
  loadedCount++
}
/** 快篩排序 cache：cacheKey → cell index 陣列。 */
const rankCache = new Map()
for (const row of readJsonl(CACHE_LOG)) rankCache.set(row.k, row.picks)
console.log(`續跑載入：既有條目 ${loadedCount} 筆、快篩 cache ${rankCache.size} 筆`)

let newCount = 0
let reworkCount = 0
let rejectCount = 0
const t0 = Date.now()

function flushBook() {
  const sorted = {}
  for (const k of Object.keys(entries).sort()) sorted[k] = entries[k]
  const book = {
    version: 1,
    source: {
      engine: 'rapfi',
      version: RAPFI_VERSION,
      commit: RAPFI_COMMIT,
      thinkTimeMs: DEEP_MS,
      generatedAt: new Date().toISOString().slice(0, 10),
    },
    entries: sorted,
  }
  writeFileSync(OUT, JSON.stringify(book))
}

/** 手順 → canonical key＋「該對稱下的建議手→canonical 方位」變換函式。
 *  並列最小的對稱取 index 最小者（與 lookup.ts 同規則，只求確定性）。 */
function canonicalize(moves) {
  let bestKey = null
  let bestT = 0
  for (let i = 0; i < SYMMETRIES.length; i++) {
    let s = ''
    for (const m of moves) {
      const p = SYMMETRIES[i](m.x, m.y)
      s += moveToStr(p)
    }
    if (bestKey === null || s < bestKey) {
      bestKey = s
      bestT = i
    }
  }
  return { key: bestKey, toCanon: SYMMETRIES[bestT] }
}

/**
 * 對局面深算一筆並入書（含雙驗＋回爐）。已有 key → 直接回既有建議手（實際方位）。
 * 回傳實際方位的建議手 Pos；失敗（驗證不過且回爐仍不過）回 null。
 */
function computeEntry(moves, ms = DEEP_MS) {
  const { key, toCanon } = canonicalize(moves)
  const existing = entries[key]
  if (existing && !FORCE_KEYS?.has(key)) {
    const hit = lookupIn(entries, moves)
    return hit ? hit.move : null
  }
  for (const [attempt, tryMs] of [[1, ms], [2, ms * 3]]) {
    const r = think(moves, tryMs)
    if (!r) return null
    const v = validateEntry(moves, r.move)
    if (v.ok) {
      const canonMove = toCanon(r.move.x, r.move.y)
      entries[key] = { move: moveToStr(canonMove), score: r.score, depth: r.depth }
      appendFileSync(
        ENTRIES_LOG,
        JSON.stringify({ key, move: moveToStr(canonMove), score: r.score, depth: r.depth, ms: tryMs }) + '\n',
      )
      FORCE_KEYS?.delete(key)
      newCount++
      if (attempt === 2) reworkCount++
      if (newCount % FLUSH_EVERY === 0) {
        flushBook()
        const dt = ((Date.now() - t0) / 60000).toFixed(1)
        console.log(`  …新增 ${newCount} 筆（回爐 ${reworkCount}／剔除 ${rejectCount}）${dt} 分`)
      }
      return r.move
    }
    console.log(`  驗證不過（${v.reason}）@${key}，${attempt === 1 ? '回爐 3 倍時間' : '剔除'}`)
    if (attempt === 2) {
      rejectCount++
      appendFileSync(
        REJECTED_LOG,
        JSON.stringify({ key, move: moveToStr(r.move), reason: v.reason }) + '\n',
      )
    }
  }
  return null
}

// ---- 候選點與快篩排序 ---------------------------------------------------------
/** 空點且 Chebyshev ≤2 內有子（同 Play.tsx candidateCells）；黑手番再濾禁手。 */
function candidateCells(moves) {
  const b = boardOfMoves(moves)
  const toMove = moves.length % 2 === 0 ? BLACK : WHITE
  const out = []
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      if (b[idx(x, y)] !== EMPTY) continue
      let near = false
      for (let dy = -2; dy <= 2 && !near; dy++)
        for (let dx = -2; dx <= 2 && !near; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || nx >= SIZE || ny < 0 || ny >= SIZE) continue
          if (b[idx(nx, ny)] !== EMPTY) near = true
        }
      if (!near) continue
      if (toMove === BLACK && isForbiddenMove(b, x, y).forbidden) continue
      out.push({ x, y })
    }
  return out
}

/**
 * 快篩排序：行棋方（moves 手番）在每個候選點落子後，用 BRANCH_MS 快算「對方視角」
 * 分數，行棋方希望對方分數愈低愈好 → 升冪排序，取前 n 個**canonical 互不等價**點。
 * 結果進 cache（跨續跑重用）。
 */
function rankCandidates(moves, n, tag) {
  const { key } = canonicalize(moves)
  const ck = `${tag}:${key}:${n}`
  const cached = rankCache.get(ck)
  if (cached) return cached.map(strToMove)
  const cands = candidateCells(moves)
  const scored = []
  for (const c of cands) {
    const r = think([...moves, c], BRANCH_MS)
    // 對方視角分數；快算失敗（不會發生）當最差
    scored.push({ c, s: r ? r.score : 99999 })
  }
  scored.sort((a, z) => a.s - z.s || idx(a.c.x, a.c.y) - idx(z.c.x, z.c.y))
  const picks = []
  const seen = new Set()
  for (const { c } of scored) {
    const k = canonicalMovesKey([...moves, c])
    if (seen.has(k)) continue
    seen.add(k)
    picks.push(c)
    if (picks.length >= n) break
  }
  rankCache.set(ck, picks.map(moveToStr))
  appendFileSync(CACHE_LOG, JSON.stringify({ k: ck, picks: picks.map(moveToStr) }) + '\n')
  return picks
}

/** 從局面沿深算主變化延伸 plies 手（每個中途局面各一筆書值）。 */
function extendMainline(moves, plies) {
  let cur = [...moves]
  for (let i = 0; i < plies; i++) {
    const mv = computeEntry(cur)
    if (!mv) return
    cur = [...cur, mv]
  }
}

// ---- 回爐模式（--recompute keys.txt）------------------------------------------
let FORCE_KEYS = null
if (RECOMPUTE_FILE) {
  const keys = readFileSync(RECOMPUTE_FILE, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean)
  FORCE_KEYS = new Set(keys)
  console.log(`回爐模式：${keys.length} 個 key，deep-ms=${DEEP_MS}`)
  for (const key of keys) {
    if (!/^([a-o][a-o])+$/.test(key)) {
      console.log(`  跳過非法 key：${key}`)
      continue
    }
    // canonical key 本身就是一段合法方位的手順
    const moves = []
    for (let i = 0; i < key.length; i += 2) moves.push(strToMove(key.slice(i, i + 2)))
    computeEntry(moves, DEEP_MS)
  }
  flushBook()
  console.log(`回爐完成：重算 ${newCount} 筆（剔除 ${rejectCount}）`)
  process.exit(0)
}

// ---- Phase A0：26 開局前三手局面（白 4 書值）-----------------------------------
console.log(`參數：deep=${DEEP_MS}ms branch=${BRANCH_MS}ms w4=${W4_BRANCHES} b5=${B5_CANDS} extend=${EXTEND}`)
const OPENING_LIST = OPENINGS.filter((o) => !ONLY_OPENINGS || ONLY_OPENINGS.has(o.id))
console.log(`Phase A0：${OPENING_LIST.length} 開局白 4 深算`)
for (const o of OPENING_LIST) {
  computeEntry(openingMoves(o))
}
flushBook()

// ---- Phase A：每開局 白4分支 × 黑五手打點 × 主變化延伸 --------------------------
for (const o of OPENING_LIST) {
  console.log(`Phase A：${o.id} ${o.name}`)
  const m3 = openingMoves(o)
  // 白 4 分支：快篩 top-K；A0 深算出的白 4 主變化保證包含在內
  const branches = rankCandidates(m3, W4_BRANCHES, 'w4')
  const bookW4 = lookupIn(entries, m3)?.move
  if (bookW4 && !branches.some((c) => c.x === bookW4.x && c.y === bookW4.y)) {
    const k0 = canonicalMovesKey([...m3, bookW4])
    if (!branches.some((c) => canonicalMovesKey([...m3, c]) === k0)) branches.unshift(bookW4)
  }
  for (const w4 of branches.slice(0, Math.max(W4_BRANCHES, 1))) {
    const m4 = [...m3, w4]
    // 黑五手兩打常見打點：快篩 top-M，各深算一筆（entry＝白第 6 手＋白視角分數，
    // 同時充當黑 offer 評值（取負）與白擇打評值）
    const b5s = rankCandidates(m4, B5_CANDS, 'b5')
    const offerVals = []
    for (const c of b5s) {
      const m5 = [...m4, c]
      computeEntry(m5)
      const e = entries[canonicalize(m5).key]
      if (e) offerVals.push({ c, blackVal: -e.score })
    }
    if (offerVals.length === 0) continue
    // 模擬規約：黑提保底最高的互不等價兩點，白擇對黑較差（白分較高）者
    offerVals.sort((a, z) => z.blackVal - a.blackVal || idx(a.c.x, a.c.y) - idx(z.c.x, z.c.y))
    const a = offerVals[0]
    const aKey = canonicalMovesKey([...m4, a.c])
    const b = offerVals.find((v, i) => i > 0 && canonicalMovesKey([...m4, v.c]) !== aKey)
    const chosen = b && b.blackVal < a.blackVal ? b.c : a.c // 白挑對黑較差點
    // 規約結束後主變化延伸（第 6 手起 EXTEND 手；第 6 手已有書值，接著往下）
    const m5 = [...m4, chosen]
    const w6 = lookupIn(entries, m5)?.move
    if (w6) extendMainline([...m5, w6], Math.max(EXTEND - 1, 0))
  }
  flushBook()
  const dt = ((Date.now() - t0) / 60000).toFixed(1)
  console.log(`  ${o.id} 完成：累計 ${Object.keys(entries).length} 筆（${dt} 分）`)
}

// ---- Phase B：自由模式黑先主流分支 ---------------------------------------------
if (!ONLY_OPENINGS) {
  console.log('Phase B：自由模式黑先前幾手')
  computeEntry([]) // 黑 1（天元）
  const m1 = [{ x: 7, y: 7 }]
  const w2s = rankCandidates(m1, W2_BRANCHES, 'w2')
  for (const w2 of w2s) {
    const m2 = [m1[0], w2]
    const b3 = computeEntry(m2) // 黑 3
    if (b3) extendMainline([...m2, b3], EXTEND)
  }
  flushBook()
}

flushBook()
const totalMin = ((Date.now() - t0) / 60000).toFixed(1)
console.log(
  `完成：書共 ${Object.keys(entries).length} 筆（本次新增 ${newCount}、回爐成功 ${reworkCount}、剔除 ${rejectCount}），耗時 ${totalMin} 分`,
)
process.exit(0)
