// Rapfi WASM 多執行緒版（rapfi-multi-simd128）冒煙測試（node 直跑，不需瀏覽器）：
//   node scripts/rapfi-smoke-multi.mjs
// 與 rapfi-smoke.mjs 的差異：
//   - 多執行緒 build 是 PROXY_TO_PTHREAD：main() 跑在 pthread，sendCommand 只是把指令
//     丟進 stdin 佇列＋atomic notify，回覆「非同步」經 onReceiveStdout 回來 → 要等 move 行。
//   - pthread 在 node 走 worker_threads：glue 用 `new Worker(__filename)` 開 pthread，
//     而 repo 是 "type": "module"，.js 會被當 ESM 載（require 失效）→ 先把 glue 複製成
//     暫存目錄的 .cjs 再 require，worker 也就跟著用 .cjs 載入。
//   - .data 權重包與單執行緒版逐位元組相同 → locateFile 直接導到 rapfi-single-simd128.data。
// 案例：
//   1. 空盤第一手（gomoku）→ 天元 7,7
//   2. 一手成五 → 2,7 或 7,7，EVAL +M1
//   3. 同一中盤局面 THREAD_NUM 1 vs 4，TIMEOUT_TURN 3000，比較 depth / nodes
import { createRequire } from 'node:module'
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  buildBoardCommand,
  buildThinkSetup,
  movesToStones,
  parseEngineLine,
} from '../src/analysis/protocol.ts'

const require = createRequire(import.meta.url)
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'rapfi') + path.sep
// RAPFI_MULTI_DIR：glue/wasm 改從別處讀（例如剛編好的 build 目錄）；.data 仍讀 public/rapfi/
const MULTI_DIR = process.env.RAPFI_MULTI_DIR ? path.resolve(process.env.RAPFI_MULTI_DIR) + path.sep : DIR

let failures = 0
function check(name, cond, detail) {
  if (cond) console.log(`  PASS ${name}`)
  else {
    failures++
    console.error(`  FAIL ${name}${detail ? ' — ' + detail : ''}`)
  }
}

const tmp = mkdtempSync(path.join(tmpdir(), 'rapfi-multi-'))
const glueCjs = path.join(tmp, 'rapfi-multi-simd128.cjs')
copyFileSync(MULTI_DIR + 'rapfi-multi-simd128.js', glueCjs)

let waiter = null // { pred, resolve }
const events = []
const raw = []
function onLine(line) {
  raw.push(line)
  const ev = parseEngineLine(line)
  events.push(ev)
  if (waiter && waiter.pred(ev)) {
    const w = waiter
    waiter = null
    w.resolve()
  }
}

const t0 = Date.now()
const Rapfi = require(glueCjs)
const engine = await Rapfi({
  locateFile: (url) => (url.endsWith('.data') ? DIR + 'rapfi-single-simd128.data' : MULTI_DIR + url),
  onReceiveStdout: onLine,
  onReceiveStderr: () => {},
  onExit: () => {},
})
console.log(`引擎載入：${Date.now() - t0}ms`)

// 送指令並等到某行出現（預設：move 行），逾時就回目前收集的
function run(cmds, pred = (e) => e.kind === 'move', timeoutMs = 30000) {
  events.length = 0
  raw.length = 0
  const t = Date.now()
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      waiter = null
      resolve({ ms: Date.now() - t, events: [...events], raw: [...raw], timedOut: true })
    }, timeoutMs)
    waiter = {
      pred,
      resolve: () => {
        clearTimeout(timer)
        // 讓同批次 stdout 收齊
        setTimeout(() => resolve({ ms: Date.now() - t, events: [...events], raw: [...raw] }), 50)
      },
    }
    for (const c of cmds) engine.sendCommand(c)
  })
}
const lastOf = (evs, kind) => evs.filter((e) => e.kind === kind).at(-1)

await run(['START 15'], (e) => e.kind === 'other' && e.text === 'OK', 10000)

console.log('案例 1：空盤第一手（gomoku）')
{
  const { ms, events: evs } = await run([...buildThinkSetup('gomoku', 2000), buildBoardCommand([], 1)])
  const mv = lastOf(evs, 'move')
  check('回傳合法建議手', !!mv, JSON.stringify(evs))
  check('空盤第一手＝天元 (7,7)', mv && mv.pos.x === 7 && mv.pos.y === 7, JSON.stringify(mv))
  console.log(`  思考：${ms}ms`)
}

console.log('案例 2：一手成五（黑 x=3..6, y=7 四連，輪黑）')
{
  const moves = [
    { x: 3, y: 7 }, { x: 3, y: 0 },
    { x: 4, y: 7 }, { x: 5, y: 0 },
    { x: 5, y: 7 }, { x: 7, y: 0 },
    { x: 6, y: 7 }, { x: 9, y: 0 },
  ]
  const { ms, events: evs } = await run([
    ...buildThinkSetup('gomoku', 2000, { threads: 4 }),
    buildBoardCommand(movesToStones(moves), 1),
  ])
  const mv = lastOf(evs, 'move')
  const ev = lastOf(evs, 'eval')
  check('建議手成五（2,7 或 7,7）', mv && mv.pos.y === 7 && (mv.pos.x === 2 || mv.pos.x === 7), JSON.stringify(mv))
  check('EVAL 報一手殺 +M1', ev && ev.text === '+M1', JSON.stringify(ev))
  console.log(`  思考：${ms}ms`)
}

console.log('案例 3：中盤局面 THREAD_NUM 1 vs 4（TIMEOUT_TURN 3000）')
{
  // 平衡中盤（非必勝/必敗）：14 手，輪黑
  const moves = [
    { x: 7, y: 7 }, { x: 8, y: 6 }, { x: 6, y: 8 }, { x: 8, y: 8 },
    { x: 8, y: 7 }, { x: 6, y: 7 }, { x: 7, y: 6 }, { x: 9, y: 7 },
    { x: 7, y: 9 }, { x: 7, y: 8 }, { x: 5, y: 9 }, { x: 6, y: 6 },
    { x: 9, y: 9 }, { x: 8, y: 9 },
  ]
  const results = {}
  for (const threads of [1, 4]) {
    // 每輪先清置換表，避免第二輪吃到第一輪同局面的 TT 而虛增深度
    const { ms, events: evs, raw: lines } = await run([
      'YXHASHCLEAR',
      ...buildThinkSetup('gomoku', 3000, { threads }),
      buildBoardCommand(movesToStones(moves), 1),
    ])
    const mv = lastOf(evs, 'move')
    const depth = lastOf(evs, 'depth')?.value
    const nodes = lastOf(evs, 'nodes')?.value
    const summary = lines.filter((l) => l.startsWith('MESSAGE')).slice(-3)
    // INFO NODES 只算主搜尋緒；全緒總節點/速度看思考結束的 MESSAGE 摘要行
    //   "MESSAGE Speed 642K | Depth 19-43 | Eval 266 | Node 1913K | Time 2979ms"
    const sm = lines.map((l) => l.match(/^MESSAGE Speed (\d+)K .*\| Node (\d+)K/)).filter(Boolean).at(-1)
    results[threads] = { ms, depth, nodes, mv, ev: lastOf(evs, 'eval')?.text, speedK: sm && +sm[1], totalK: sm && +sm[2] }
    check(`THREAD_NUM ${threads} 回傳建議手`, !!mv, JSON.stringify(lines.slice(-10)))
    console.log(`  THREAD_NUM ${threads}: ${ms}ms depth=${depth} INFO NODES=${nodes} 總節點=${results[threads].totalK}K 速度=${results[threads].speedK}K/s move=${mv && `${mv.pos.x},${mv.pos.y}`} eval=${results[threads].ev}`)
    for (const s of summary) console.log(`    ${s}`)
  }
  if (results[1].speedK && results[4].speedK)
    console.log(`  速度倍率（4 緒 / 1 緒）：${(results[4].speedK / results[1].speedK).toFixed(2)}x，深度 ${results[1].depth} → ${results[4].depth}`)
}

rmSync(tmp, { recursive: true, force: true })
console.log(failures === 0 ? '冒煙測試全數通過' : `冒煙測試失敗 ${failures} 項`)
process.exit(failures === 0 ? 0 : 1)
