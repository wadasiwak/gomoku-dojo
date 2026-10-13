// 塔拉山口-10 AI 開局決策模擬（node 直跑 Rapfi WASM，不需瀏覽器）：
//   node scripts/tara-ai-sim.mjs [--games 4] [--force-ten]
// 讓 AI 對 AI 走完開局（擺子／交換／白 4 後三選一／十打／擇一），印出每一步的決策、
// 黑方視角分數與耗時；最後印出開局結束時的局面評估——用來確認：
//   1. 決策流程不卡、每步耗時在可接受範圍（瀏覽器單執行緒約等速）
//   2. 「均衡擺子」真的把分數壓在 0 附近、白 4 防十打、十打值與擇一方向正確
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  buildBoardCommand,
  buildThinkSetup,
  movesToStones,
  parseEngineLine,
  evalTextToScore,
} from '../src/analysis/protocol.ts'
import { taraInitial, taraReduce, taraPhase, actorColor, firstPlayerColor } from '../src/tara/protocol.ts'
import { aiPlaceBalanced, aiSwap, aiTenPlan, decideBranch, aiChooseOffer } from '../src/tara/ai.ts'

const require = createRequire(import.meta.url)
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'rapfi') + path.sep
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`)
  return i > 0 ? process.argv[i + 1] : d
}
const GAMES = +arg('games', 2)
/** --force-ten：白 4 後一律選十打（驗十打擺放／擇一路徑）。 */
const FORCE_TEN = process.argv.includes('--force-ten')

function loadGlueAsCjs(file) {
  const mod = { exports: {} }
  const fn = new Function('module', 'exports', 'require', '__dirname', '__filename', readFileSync(file, 'utf8'))
  fn(mod, mod.exports, require, path.dirname(file), file)
  return mod.exports
}

const events = []
const Rapfi = loadGlueAsCjs(DIR + 'rapfi-single-simd128.js')
const engine = await Rapfi({
  locateFile: (url) => DIR + url,
  onReceiveStdout: (line) => events.push(parseEngineLine(line)),
  onReceiveStderr: () => {},
  onExit: () => {},
})
const run = (cmds) => {
  events.length = 0
  for (const c of cmds) engine.sendCommand(c)
  return [...events]
}
run(['START 15'])

/** 與瀏覽器 oracle 同語意：分數為待下方視角。 */
const oracle = {
  async evaluate(moves, timeMs) {
    const toMove = moves.length % 2 === 0 ? 1 : 2
    const evs = run([...buildThinkSetup('renju', timeMs), buildBoardCommand(movesToStones(moves), toMove, true)])
    return evalTextToScore(evs.filter((e) => e.kind === 'eval').at(-1)?.text)
  },
  async nbest(moves, n, timeMs) {
    const toMove = moves.length % 2 === 0 ? 1 : 2
    const evs = run([
      ...buildThinkSetup('renju', timeMs),
      buildBoardCommand(movesToStones(moves), toMove, false),
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
  },
}

const name = (p) => `${String.fromCharCode(65 + p.x)}${15 - p.y}`
let seed = 1
const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)

for (let g = 0; g < GAMES; g++) {
  seed = 1000 + g
  let s = taraInitial()
  const act = (a) => {
    const { next, error } = taraReduce(s, a)
    if (error) throw new Error(`${error} ← ${JSON.stringify(a)}`)
    s = next
  }
  console.log(`\n=== 第 ${g + 1} 局 ===`)
  let plan = null
  for (let guard = 0; guard < 30 && taraPhase(s) !== 'normal'; guard++) {
    const ph = taraPhase(s)
    const t0 = Date.now()
    let line = ''
    if (ph === 'place') {
      const r = await aiPlaceBalanced(s, oracle, rng)
      act({ type: 'place', pos: r.move })
      line = `第 ${s.moves.length} 手 ${name(r.move)}（黑方 ${r.black ?? '—'}${r.tenValue !== undefined ? `；對方十打值 ${r.tenValue}` : ''}）`
    } else if (ph === 'swap') {
      const r = await aiSwap(s, actorColor(s), oracle)
      act({ type: 'swap', swap: r.swap })
      line = `交換？${r.swap ? '換' : '不換'}（黑方 ${r.black}）`
    } else if (ph === 'branch') {
      plan = await aiTenPlan(s, oracle)
      const b = FORCE_TEN ? 'ten' : decideBranch(plan)
      act({ type: 'branch', choice: b })
      line = `白 4 後選：${{ ten: '①十打', black: '②持黑', white: '③持白' }[b]}（十打值 ${plan.value}）`
    } else if (ph === 'offer10') {
      if (!plan) plan = await aiTenPlan(s, oracle)
      act({ type: 'offer', offers: plan.offers })
      line = `十打：${plan.offers.map(name).join(' ')}`
    } else if (ph === 'choose10') {
      const r = await aiChooseOffer(s, oracle)
      act({ type: 'choose', pos: r.move })
      line = `擇 ${name(r.move)}（黑方 ${r.black}；全部 ${r.all.map((a) => `${name(a.move)}:${a.black}`).join(' ')}）`
    }
    console.log(`  ${line}　${Date.now() - t0}ms`)
  }
  const final = await oracle.evaluate(s.moves, 3000)
  const fb = final === null ? null : s.moves.length % 2 === 0 ? final : -final
  console.log(
    `  開局結束：${s.moves.map(name).join(' ')}｜先手者現執${firstPlayerColor(s.meta) === 1 ? '黑' : '白'}｜黑方 3s 評估 ${fb}`,
  )
}
