// 推薦精選陷阱的 10 秒複驗（單執行緒）：沿 2 秒判定的勝方路線，每步重算多 PV 8 個候選、
// 記錄 10 秒下有哪些必勝著（2 秒常把「1～2 手」判成唯一）。結果 scratch/white4/verify.json，
// tara-white4-report.mjs 讀來標在推薦精選上。
//   node scripts/tara-white4-verify.mjs
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { readdirSync, writeFileSync } from 'node:fs'
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const { buildBoardCommand, buildThinkSetup, movesToStones, parseEngineLine, evalTextToScore } = await import(ROOT + '/src/analysis/protocol.ts')
const { OPENINGS, openingMoves } = await import(ROOT + '/src/content/openings.ts')
const require = createRequire(ROOT + '/package.json')
const DIR = ROOT + '/public/rapfi/'
const mod = { exports: {} }
new Function('module', 'exports', 'require', '__dirname', '__filename', readFileSync(DIR + 'rapfi-single-simd128.js', 'utf8'))(mod, mod.exports, require, DIR, DIR + 'x.js')
const ev = []
const eng = await mod.exports({ locateFile: (u) => DIR + u, onReceiveStdout: (l) => ev.push(parseEngineLine(l)), onReceiveStderr() {}, onExit() {} })
eng.sendCommand('START 15')

const N = (p) => String.fromCharCode(65 + p.x) + (15 - p.y)
function nbest(moves, n, ms) {
  ev.length = 0
  for (const c of [...buildThinkSetup('renju', ms), buildBoardCommand(movesToStones(moves), moves.length % 2 ? 2 : 1, false), `YXNBEST ${n}`]) eng.sendCommand(c)
  const out = new Map(); let cur = null
  for (const e of ev) {
    if (e.kind === 'pv') cur = { i: e.index }
    else if (e.kind === 'eval' && cur) cur.t = e.text
    else if (e.kind === 'bestline' && cur && e.pv.length) cur.m = e.pv[0]
    else if (e.kind === 'pvdone' && cur) { if (cur.m) out.set(cur.i, { m: cur.m, s: evalTextToScore(cur.t), t: cur.t }); cur = null }
  }
  return [...out.values()]
}
function best(moves, ms) {
  ev.length = 0
  for (const c of [...buildThinkSetup('renju', ms), buildBoardCommand(movesToStones(moves), moves.length % 2 ? 2 : 1, true)]) eng.sendCommand(c)
  return { m: ev.filter((e) => e.kind === 'move').at(-1)?.pos, t: ev.filter((e) => e.kind === 'eval').at(-1)?.text }
}
const VERIFY_MS = 10000

// ---- 推薦精選前 12 名（與 tara-white4-report.mjs 同一套排序）逐一 10 秒複驗 ----
const OUT = path.join(ROOT, 'scratch', 'white4')
const rows = readdirSync(OUT).filter((f) => /^phaseB2.*\.jsonl$/.test(f)).flatMap((f) => readFileSync(path.join(OUT, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)))
const trapRank = (a, b) => b.onlyMoves - a.onlyMoves || (a.narrow ?? 99) - (b.narrow ?? 99)
const picks = []
for (const r of rows.filter((x) => x.viable && x.guide && x.winCount < 10)) {
  const good = r.traps.filter((t) => t.steps.length > 0 && t.onlyMoves > 0).sort(trapRank).slice(0, 3)
  if (!good.length) continue
  picks.push({ r, good, score: good.reduce((a, t) => a + (t.onlyMoves >= 2 ? 2 : 1), 0) })
}
picks.sort((a, b) => b.score - a.score || b.good[0].onlyMoves - a.good[0].onlyMoves)
const result = {}
for (const p of picks.slice(0, 14)) {
  const o = OPENINGS.find((x) => x.id === p.r.opening)
  for (const t of p.good.slice(0, 2)) {
    let line = [...openingMoves(o), p.r.w4, t.b5]
    const steps = []
    for (const st of t.steps) {
      const c = nbest(line, 8, VERIFY_MS)
      const mates = c.filter((x) => x.s !== null && x.s > 20000)
      // 這步走 2 秒判定的勝著，接著敵方最頑強應手
      steps.push({ ply: st.ply, mates: mates.map((x) => x.m), top: c.slice(0, 3).map((x) => ({ m: x.m, t: x.t })) })
      line = [...line, st.best]
      const r = best(line, 5000)
      steps[steps.length - 1].after = r.t // 下完預定勝著、敵方應手前的評估（敵方視角）
      if (!r.m) break
      line = [...line, r.m]
    }
    const key = `${p.r.opening}|${p.r.w4.x},${p.r.w4.y}|${t.b5.x},${t.b5.y}`
    result[key] = steps
    console.log(o.name, N(p.r.w4), N(t.b5), steps.map((s) => `${s.ply}:${s.mates.map(N).join('/') || '未算到'}`).join(' '))
  }
}
writeFileSync(path.join(OUT, 'verify.json'), JSON.stringify(result))
process.exit(0)
