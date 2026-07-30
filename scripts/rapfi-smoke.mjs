// Rapfi WASM 冒煙測試（node 直跑，不需瀏覽器）：
//   node scripts/rapfi-smoke.mjs
// 直接 require public/rapfi/ 的 Emscripten glue（node 環境走 fs 讀 wasm/data），
// 用 src/analysis/protocol.ts 的同一套組裝/解析函式跑三個 sanity 案例：
//   1. 空盤第一手（gomoku）→ 必須是天元 7,7
//   2. 一手成五（黑四連 x=3..6,y=7）→ 必須補在 2,7 或 7,7，EVAL 報 +M1
//   3. 連珠禁手（(7,7) 三三）→ YXSHOWFORBID 必須列出 0707
// 引擎輸出座標框與輸入一致（案例 2/3 同時釘住這件事——座標若被翻轉這裡會炸）。
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
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

let failures = 0
function check(name, cond, detail) {
  if (cond) console.log(`  PASS ${name}`)
  else {
    failures++
    console.error(`  FAIL ${name}${detail ? ' — ' + detail : ''}`)
  }
}

// repo 是 "type": "module"，require 會把 glue 當 ESM 載（module.exports 失效）
// → 手動以 CJS 語意執行 glue（Emscripten MODULARIZE 輸出本質是傳統 script + UMD 尾巴）。
function loadGlueAsCjs(file) {
  const mod = { exports: {} }
  const fn = new Function('module', 'exports', 'require', '__dirname', '__filename', readFileSync(file, 'utf8'))
  fn(mod, mod.exports, require, path.dirname(file), file)
  return mod.exports
}

const events = []
const t0 = Date.now()
const Rapfi = loadGlueAsCjs(DIR + 'rapfi-single-simd128.js')
const engine = await Rapfi({
  locateFile: (url) => DIR + url,
  onReceiveStdout: (line) => events.push(parseEngineLine(line)),
  onReceiveStderr: () => {},
  onExit: () => {},
})
const loadMs = Date.now() - t0
console.log(`引擎載入：${loadMs}ms`)

// 單執行緒 build：sendCommand 同步執行，回來時輸出已全部進 events
function run(cmds) {
  events.length = 0
  const t = Date.now()
  for (const c of cmds) engine.sendCommand(c)
  return { ms: Date.now() - t, events: [...events] }
}
const lastMove = (evs) => evs.filter((e) => e.kind === 'move').at(-1)
const lastEval = (evs) => evs.filter((e) => e.kind === 'eval').at(-1)

run(['START 15'])

console.log('案例 1：空盤第一手（gomoku）')
{
  const { ms, events: evs } = run([...buildThinkSetup('gomoku', 2000), buildBoardCommand([], 1)])
  const mv = lastMove(evs)
  check('回傳合法建議手', !!mv, JSON.stringify(evs))
  check('空盤第一手＝天元 (7,7)', mv && mv.pos.x === 7 && mv.pos.y === 7, JSON.stringify(mv))
  console.log(`  思考：${ms}ms`)
}

console.log('案例 2：一手成五（黑 x=3..6, y=7 四連，輪黑）')
{
  // 手順：黑 3,7 4,7 5,7 6,7 交替夾白遠端子 → 8 手後輪黑
  const moves = [
    { x: 3, y: 7 }, { x: 3, y: 0 },
    { x: 4, y: 7 }, { x: 5, y: 0 },
    { x: 5, y: 7 }, { x: 7, y: 0 },
    { x: 6, y: 7 }, { x: 9, y: 0 },
  ]
  const { ms, events: evs } = run([
    ...buildThinkSetup('gomoku', 2000),
    buildBoardCommand(movesToStones(moves), 1),
  ])
  const mv = lastMove(evs)
  const ev = lastEval(evs)
  check('建議手成五（2,7 或 7,7）', mv && mv.pos.y === 7 && (mv.pos.x === 2 || mv.pos.x === 7), JSON.stringify(mv))
  check('EVAL 報一手殺 +M1', ev && ev.text === '+M1', JSON.stringify(ev))
  console.log(`  思考：${ms}ms`)
}

console.log('案例 3：連珠禁手（(7,7) 三三）')
{
  // 黑 (7,6)(7,8) 直向、(6,7)(8,7) 橫向：(7,7) 落下同時成兩活三
  const moves = [
    { x: 7, y: 6 }, { x: 3, y: 0 },
    { x: 7, y: 8 }, { x: 5, y: 0 },
    { x: 6, y: 7 }, { x: 9, y: 0 },
    { x: 8, y: 7 }, { x: 11, y: 0 },
  ]
  const { events: evs } = run([
    'INFO RULE 4',
    buildBoardCommand(movesToStones(moves), 1, false), // YXBOARD：只設局面不思考
    'YXSHOWFORBID',
  ])
  const forbid = evs.filter((e) => e.kind === 'forbid').at(-1)
  check('FORBID 列出 (7,7)', !!forbid && forbid.points.some((p) => p.x === 7 && p.y === 7), JSON.stringify(forbid))

  // 加碼：輪黑思考時，引擎不得踩 (7,7) 禁手
  const { ms, events: evs2 } = run([
    ...buildThinkSetup('renju', 2000),
    buildBoardCommand(movesToStones(moves), 1),
  ])
  const mv = lastMove(evs2)
  check('renju 輪黑不踩三三禁手', mv && !(mv.pos.x === 7 && mv.pos.y === 7), JSON.stringify(mv))
  console.log(`  思考：${ms}ms`)
}

console.log(failures === 0 ? '冒煙測試全數通過' : `冒煙測試失敗 ${failures} 項`)
process.exit(failures === 0 ? 0 : 1)
