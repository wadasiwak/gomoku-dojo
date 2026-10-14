// 塔拉山口-10「防十打白 4」調查（國手 2026-10-13 委託，名人賽備戰）：
//   node scripts/tara-white4-survey.mjs [--openings d1,i7] [--threads 8]
//
// 戰術：白 4 下完後對方（執黑）三選一。國手定義：十打成立＝黑有 10 個兩兩不對稱的
// 「必勝」第 5 手；只要不到 10 個，白就挑不必勝那點 → 對方只能走②③。黑 5 的選擇
// 我方事先準備：找「陷阱」黑 5——已分勝負、但勝方得一路下對很窄的路，對方現場難算。
//
// 流程（Rapfi 多執行緒 WASM，node 直跑；逐筆 append 到 scratch/white4/*.jsonl，可斷點續跑）：
//   A.  每開局：中央 7×7 所有白 4（對稱去重）→ 多 PV 16（3s）粗算必勝點數與黑最佳分數。
//   B2. 粗算必勝 < 10 的白 4 依黑最佳分數由高到低（看起來越黑優越好）逐一精算：盤上各子
//       周圍 2 格每個黑 5 深算 2s → 必勝點數（< 10 才算可用）＋9×9 黑 5 速查表；可用者再對
//       已分勝負（必勝或 |分數| ≥ 800）的黑 5 沿主變化走勝方接下來 3 次落子，每次多 PV 數
//       「仍保持勝勢」的著手數（越少越難）。每開局收滿 PER_OPENING 手可用白 4 為止。
// 產出報告：node scripts/tara-white4-report.mjs
import { createRequire } from 'node:module'
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  buildBoardCommand,
  buildThinkSetup,
  movesToStones,
  parseEngineLine,
  evalTextToScore,
} from '../src/analysis/protocol.ts'
import { OPENINGS, openingMoves } from '../src/content/openings.ts'
import { canonicalBoardKey } from '../src/engine/symmetry.ts'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIR = path.join(ROOT, 'public', 'rapfi') + path.sep
const OUT = path.join(ROOT, 'scratch', 'white4')
mkdirSync(OUT, { recursive: true })

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`)
  return i > 0 ? process.argv[i + 1] : d
}
/** 引擎：single（預設，穩）｜multi（多執行緒，2026-10-14 實測連續搜尋後會不定時卡死，
 *  同局面單獨重算又正常＝競態，非局面問題；單執行緒版同批 49 局面全過）。 */
const ENGINE = arg('engine', 'single')
const THREADS = ENGINE === 'multi' ? +arg('threads', 8) : 1
/** 平行跑多個行程時各自的輸出後綴（避免多行程同寫一檔交錯）。 */
const TAG = arg('tag', '')
const ONLY = arg('openings', null)?.split(',')
/** --guide scratch/white4/guide.json：白 4 改取《漱星閣開局指南》中防十打（黑必勝點 < 10）的
 *  變化（現任名人整理，scripts/parse-opening-guide.mjs 產生），略過 A 階段自選。 */
const GUIDE = arg('guide', null)
const guide = GUIDE ? JSON.parse(readFileSync(GUIDE, 'utf8')) : null
/** 每開局要找幾手可用白 4（國手：3～5 手）。 */
const PER_OPENING = +arg('per', 4)
const A_MS = 3000
/** 黑 5 逐點深算（必勝點判定靠它，太短會漏算必勝）。 */
const B_DEEP_MS = 2000
/** 陷阱路線：最多分析幾個已分勝負的黑 5、每步多 PV 數與時間。 */
const TRAP_MAX = 6
const TRAP_NBEST = 6
const TRAP_MS = 2000

// ---- 引擎 ----
// multi：glue 複製成 .cjs 再 require（pthread 走 worker_threads，見 rapfi-smoke-multi.mjs）
// single：以 CJS 語意執行 glue（見 rapfi-smoke.mjs loadGlueAsCjs）；sendCommand 同步思考
const require = createRequire(import.meta.url)
let Rapfi
if (ENGINE === 'multi') {
  const tmp = mkdtempSync(path.join(tmpdir(), 'rapfi-w4-'))
  const glueCjs = path.join(tmp, 'rapfi-multi-simd128.cjs')
  copyFileSync(DIR + 'rapfi-multi-simd128.js', glueCjs)
  Rapfi = require(glueCjs)
} else {
  const file = DIR + 'rapfi-single-simd128.js'
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', '__dirname', '__filename', readFileSync(file, 'utf8'))(
    mod,
    mod.exports,
    require,
    path.dirname(file),
    file,
  )
  Rapfi = mod.exports
}
let waiter = null
const events = []
const engine = await Rapfi({
  locateFile: (url) => (url.endsWith('.data') ? DIR + 'rapfi-single-simd128.data' : DIR + url),
  onReceiveStdout: (line) => {
    const ev = parseEngineLine(line)
    events.push(ev)
    if (waiter && waiter.pred(ev)) {
      const w = waiter
      waiter = null
      // 立刻取消逾時：單執行緒版同步思考時事件迴圈被佔住，若延後到 setTimeout 才取消，
      // 思考／載入超過時限時逾時回呼會先跑而誤判卡死（4 行程平行載入權重實測踩到）
      clearTimeout(w.timer)
      setTimeout(() => w.resolve([...events]), 20)
    }
  },
  onReceiveStderr: () => {},
  onExit: (c) => {
    console.error('引擎結束', c)
    process.exit(2)
  },
})
function run(cmds, pred = (e) => e.kind === 'move' || e.kind === 'error', timeoutMs = 120000) {
  events.length = 0
  return new Promise((resolve) => {
    // 逾時＝引擎卡死（多執行緒版偶發）→ 直接結束行程，由外層迴圈重啟、斷點續跑
    const timer = setTimeout(() => {
      console.error('引擎逾時，結束行程等外層重啟')
      process.exit(3)
    }, timeoutMs)
    waiter = { pred, timer, resolve }
    for (const c of cmds) engine.sendCommand(c)
  })
}
if (ENGINE === 'multi') {
  engine.sendCommand(`INFO THREAD_NUM ${THREADS}`) // 只在 START 前設一次；START 後再送（即使同值）會死鎖
  await new Promise((r) => setTimeout(r, 100))
}
await run(['START 15'], (e) => e.kind === 'other' && e.text === 'OK', 10000)
await new Promise((r) => setTimeout(r, 500)) // START 後稍等再開始搜尋（多執行緒版競態）
/** 思考前設定：不帶 THREAD_NUM（多執行緒版只在 START 前設一次）。 */
const setupCmds = (ms, limits = {}) =>
  buildThinkSetup('renju', ms, limits).filter((c) => !c.startsWith('INFO THREAD_NUM'))

const toMoveOf = (moves) => (moves.length % 2 === 0 ? 1 : 2)
/** 單一局面：待下方視角分數＋主變化。 */
async function evaluate(moves, ms, limits = {}) {
  const evs = await run([
    ...setupCmds(ms, limits),
    buildBoardCommand(movesToStones(moves), toMoveOf(moves), true),
  ])
  return {
    score: evalTextToScore(evs.filter((e) => e.kind === 'eval').at(-1)?.text),
    text: evs.filter((e) => e.kind === 'eval').at(-1)?.text,
    pv: evs.filter((e) => e.kind === 'bestline').at(-1)?.pv ?? [],
  }
}
/** 多 PV：每個候選（待下方視角）。 */
async function nbest(moves, n, ms) {
  const evs = await run([
    ...setupCmds(ms),
    buildBoardCommand(movesToStones(moves), toMoveOf(moves), false),
    `YXNBEST ${n}`,
  ])
  const committed = new Map()
  let cur = null
  for (const e of evs) {
    if (e.kind === 'pv') cur = { index: e.index, pv: [], text: undefined }
    else if (e.kind === 'eval' && cur) cur.text = e.text
    else if (e.kind === 'bestline' && cur && e.pv.length) cur.pv = e.pv
    else if (e.kind === 'pvdone' && cur) {
      if (cur.pv.length) committed.set(cur.index, { move: cur.pv[0], score: evalTextToScore(cur.text) })
      cur = null
    }
  }
  return [...committed.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v)
}

// ---- 幾何 ----
const C = { x: 7, y: 7 }
const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))
function keyOf(moves, extra) {
  const b = new Uint8Array(225)
  moves.forEach((m, i) => (b[m.y * 15 + m.x] = i % 2 === 0 ? 1 : 2))
  if (extra) b[extra.y * 15 + extra.x] = moves.length % 2 === 0 ? 1 : 2
  return canonicalBoardKey(b)
}
/** 下一手候選：（可選）範圍限制、空點、（可選）距既有子 ≤2，對稱去重。 */
function candidates(moves, { limit = null, near = true } = {}) {
  const out = []
  const seen = new Set()
  for (let y = 0; y < 15; y++)
    for (let x = 0; x < 15; x++) {
      const p = { x, y }
      if (limit !== null && cheb(p, C) > limit) continue
      if (moves.some((m) => m.x === x && m.y === y)) continue
      if (near && !moves.some((m) => cheb(m, p) <= 2)) continue
      const k = keyOf(moves, p)
      if (seen.has(k)) continue
      seen.add(k)
      out.push(p)
    }
  return out
}
/** 十打值：分數由高到低取兩兩不等價的前 10 個，回第 10 個分數（不足 10 個回 null）。 */
function tenValueOf(moves, scored) {
  const seen = new Set()
  const picked = []
  for (const s of [...scored].sort((a, b) => b.score - a.score)) {
    if (s.score === null) continue
    const k = keyOf(moves, s.move)
    if (seen.has(k)) continue
    seen.add(k)
    picked.push(s)
    if (picked.length === 10) break
  }
  return picked.length === 10 ? picked[9].score : null
}

// ---- 斷點續跑 ----
const readJsonl = (f) =>
  existsSync(f)
    ? readFileSync(f, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : []
const FA = path.join(OUT, 'phaseA.jsonl')
const FB2 = path.join(OUT, `phaseB2${TAG}.jsonl`)
/** 已完成判定要看所有行程的輸出（phaseB2*.jsonl）。 */
const allB2 = () =>
  readdirSync(OUT)
    .filter((f) => /^phaseB2.*\.jsonl$/.test(f))
    .flatMap((f) => readJsonl(path.join(OUT, f)))
const id4 = (o, w4) => `${o}|${w4.x},${w4.y}`
const doneA = new Set(readJsonl(FA).map((r) => id4(r.opening, r.w4)))
const doneB2 = new Set(allB2().map((r) => id4(r.opening, r.w4)))
// 毒局面保險：某些局面會讓多執行緒引擎卡死甚至崩潰（Illegal instruction，2026-10-14 名月實測、
// 每次重現）。處理每手白 4 前寫 INPROGRESS；行程若因此死掉，重啟時讀到同一手 → 嘗試次數 +1，
// 第 2 次就記進 SKIP 略過（報告列出），不讓整晚卡在同一手。
const FINPROG = path.join(OUT, `inprogress${TAG}.json`)
const FSKIP = path.join(OUT, 'skipped.jsonl')
const skipped = new Set(readJsonl(FSKIP).map((r) => r.id))
if (existsSync(FINPROG)) {
  const prev = JSON.parse(readFileSync(FINPROG, 'utf8'))
  if (prev.attempts >= 2 && !skipped.has(prev.id)) {
    appendFileSync(FSKIP, JSON.stringify({ id: prev.id, reason: '引擎卡死／崩潰 2 次' }) + '\n')
    skipped.add(prev.id)
    console.error(`略過毒局面 ${prev.id}`)
  }
}
const markInProgress = (id) => {
  const prev = existsSync(FINPROG) ? JSON.parse(readFileSync(FINPROG, 'utf8')) : null
  writeFileSync(FINPROG, JSON.stringify({ id, attempts: prev && prev.id === id ? prev.attempts + 1 : 1 }))
}

const t0 = Date.now()
const elapsed = () => `${((Date.now() - t0) / 60000).toFixed(1)}m`
const name = (p) => `${String.fromCharCode(65 + p.x)}${15 - p.y}`

// --openings 給的順序就是執行順序（國手指定先看流星、名月、彗星、遊星）
const ORDERED = ONLY ? ONLY.map((id) => OPENINGS.find((o) => o.id === id)).filter(Boolean) : OPENINGS
for (const o of ORDERED) {
  const base = openingMoves(o)

  // ---- A：所有白 4 粗篩（指南模式略過）----
  const w4s = guide ? [] : candidates(base, { limit: 3, near: false })
  for (let i = 0; i < w4s.length; i++) {
    const w4 = w4s[i]
    if (doneA.has(id4(o.id, w4))) continue
    const moves = [...base, w4]
    const lines = await nbest(moves, 16, A_MS) // 黑待下 → 分數即黑方視角
    const in9 = lines.filter((l) => cheb(l.move, C) <= 4 && l.score !== null)
    appendFileSync(
      FA,
      JSON.stringify({
        opening: o.id,
        w4,
        best: lines[0]?.score ?? null,
        best9: in9.length ? Math.max(...in9.map((l) => l.score)) : null,
        tenRough: tenValueOf(moves, lines),
        lines,
      }) + '\n',
    )
    console.log(`[${elapsed()}] A ${o.name} 白4 ${name(w4)} (${i + 1}/${w4s.length})`)
  }

  // ---- B2：入選白 4 → 必勝點精算（防十打判定）＋黑 5 速查＋陷阱路線 ----
  // 國手定義（2026-10-13）：十打成立＝黑找得到 10 個兩兩不對稱的「必勝」第 5 手；
  // 不到 10 個，白就挑不必勝的那點 → 白 4 可用。陷阱＝黑 5 後一方已勝勢、但勝方
  // 接下來要一路下對很窄的路（有的步只有一手能贏）——對方現場很難算對。
  const rowsA = readJsonl(FA).filter((r) => r.opening === o.id)
  const mates = (r) => r.lines.filter((l) => l.score !== null && l.score > 20000).length
  // 粗篩可用（粗算必勝 < 10），依黑最佳分數由高到低（「看起來黑大優」優先，最像國手說的戰術）
  // 粗算會大幅低估必勝點（實測花月 E10 粗算 7、精算 19）→ 先試粗算 ≤3 的，再依黑最佳由高到低
  const queue = guide
    ? // 指南模式：指南判定可用的白 4，黑必勝點多的（看起來最黑優）優先
      guide
        .filter((g) => g.opening === o.id && g.viable)
        .sort((a, b) => b.winCount - a.winCount)
        .map((g) => ({
          w4: g.w4,
          lines: [],
          best: null,
          hard: g.hard,
          guide: { variation: g.variation, winCount: g.winCount, page: g.page, hard: g.hard, notes: g.notes },
        }))
    : rowsA
        .filter((r) => mates(r) < 10)
        .sort((a, b) => (mates(a) > 3) - (mates(b) > 3) || (b.best ?? -1e9) - (a.best ?? -1e9))
  // 上限只算一般白 4；指南「困難」變化（生死局？／不確定必勝點）國手要求一律加算
  let accepted = allB2().filter(
    (r) => r.opening === o.id && r.viable && !!r.guide === !!guide && !r.guide?.hard,
  ).length
  for (const r of queue) {
    if (!r.hard && accepted >= PER_OPENING) continue
    if (doneB2.has(id4(o.id, r.w4)) || skipped.has(id4(o.id, r.w4))) continue
    markInProgress(id4(o.id, r.w4))
    const moves = [...base, r.w4]
    // 1) 逐點深算：盤上各子周圍 2 格（十打可擺全盤，實務上好點都在附近）
    const scan = []
    for (const b5 of candidates(moves)) {
      const ev = await evaluate([...moves, b5], B_DEEP_MS) // 白待下 → 黑方視角取負
      scan.push({ pos: b5, score: ev.score === null ? null : -ev.score, in9: cheb(b5, C) <= 4 })
    }
    const winCount = scan.filter((s) => s.score !== null && s.score > 20000).length
    // 指南模式：可用與否以指南為準（名人整理），本站精算的必勝點數另存供交叉比對
    const viable = r.guide ? true : winCount < 10
    // 2) 陷阱：9×9 內、已分勝負（必勝或 |分數| ≥ 800）的黑 5，沿主變化走勝方接下來 3 次落子，
    //    每次數「仍保持勝勢」的著手數（多 PV）
    const traps = []
    if (viable) {
      const decisive = scan
        .filter((s) => s.in9 && s.score !== null && Math.abs(s.score) >= 800)
        .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
        .slice(0, TRAP_MAX)
      for (const d of decisive) {
        try {
        const winner = d.score > 0 ? 1 : 2 // 1 黑 2 白
        let line = [...moves, d.pos]
        const steps = []
        for (let guard = 0; guard < 8 && steps.length < 3; guard++) {
          const mover = line.length % 2 === 0 ? 1 : 2
          if (mover === winner) {
            const cands = await nbest(line, TRAP_NBEST, TRAP_MS) // 勝方視角
            const best = cands[0]
            // 最佳手是必勝 → 只算同樣必勝的；否則算「仍大優（≥800）」的
            const bestMate = best && best.score !== null && best.score > 20000
            const winning = cands.filter(
              (c) => c.score !== null && (bestMate ? c.score > 20000 : c.score >= 800),
            )
            if (!best) break
            steps.push({ ply: line.length + 1, count: winning.length, of: cands.length, moves: winning.map((c) => c.move), best: best.move, score: best.score })
            line = [...line, best.move]
          } else {
            const rep = await evaluate(line, TRAP_MS) // 敗方最頑強的應手
            if (!rep.pv[0]) break
            line = [...line, rep.pv[0]]
          }
        }
        traps.push({
          b5: d.pos,
          score: d.score,
          winner,
          steps,
          line: line.slice(moves.length),
          narrow: steps.length ? Math.min(...steps.map((x) => x.count)) : null,
          onlyMoves: steps.filter((x) => x.count === 1).length,
        })
        } catch (e) {
          console.error(`  陷阱 ${name(d.pos)} 分析失敗，略過：${e.message}`)
        }
      }
    }
    if (viable && !r.hard) accepted++
    appendFileSync(
      FB2,
      JSON.stringify({ opening: o.id, w4: r.w4, viable, winCount, roughMates: mates(r), guide: r.guide ?? null, scan, traps }) + '\n',
    )
    console.log(
      `[${elapsed()}] B2 ${o.name} 白4 ${name(r.w4)}${r.guide ? `（指南：${r.guide.variation}，必勝點 ${r.guide.winCount}）` : ''}：本站精算必勝點 ${winCount}${viable ? `✓ 陷阱候選 ${traps.length}` : '✗ 十打成立'}`,
    )
  }
}
console.log(`全部完成 ${elapsed()}`)
process.exit(0)
