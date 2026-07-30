// Rapfi WASM 瀏覽器端驗證（playwright + vite dev:5313，獨立於正式 e2e，不進路由）：
// 直接在頁面 context dynamic import src/analysis/rapfi.ts（dev server 即時轉譯 TS），
// 走真實 Worker + importScripts + wasm/data fetch 路徑跑三個 sanity 案例：
//   1. 空盤第一手（gomoku）→ 天元 (7,7)
//   2. 一手成五 → (2,7)/(7,7)，evalText=+M1、pv[0]=建議手
//   3. 連珠禁手局面輪黑 → 不踩 (7,7) 三三
// 並記錄載入時間（worker 起+wasm/data 載+引擎初始化）與各案例思考時間。
//
//   node scripts/rapfi-e2e.mjs
//
// 為什麼用 vite dev 而不是 build+preview：UI 尚未接線，rapfi.ts 沒被 app import、
// 不會進 production bundle；dev server 可直接 import 原始 TS 模組。
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { chromium } from 'playwright'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const PORT = 5313 // 5310 dev / 5311 e2e / 5312 截圖已占用
const BASE = `http://localhost:${PORT}`

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  cwd: ROOT,
  stdio: 'ignore',
})

async function waitServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(BASE)
      if (r.ok) return
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('dev server 起不來')
}

const fails = []
function check(name, cond, detail) {
  if (cond) console.log(`✓ ${name}`)
  else {
    fails.push(name)
    console.error(`✗ ${name}${detail ? '：' + detail : ''}`)
  }
}

try {
  await waitServer()
  const browser = await chromium.launch()
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.error('[pageerror]', e.message))
  await page.goto(BASE + '/')

  const result = await page.evaluate(async () => {
    const mod = await import('/src/analysis/rapfi.ts')
    const client = new mod.RapfiClient()
    const out = { supported: mod.isRapfiSupported(), attribution: mod.RAPFI_ATTRIBUTION }

    const t0 = performance.now()
    await client.preload()
    out.loadMs = Math.round(performance.now() - t0)

    // 案例 1：空盤第一手（gomoku）
    out.empty = await client.analyze({ moves: [] }, 'gomoku', 2000)

    // 案例 2：一手成五（黑 x=3..6,y=7 四連，輪黑）
    const winMoves = [
      { x: 3, y: 7 }, { x: 3, y: 0 },
      { x: 4, y: 7 }, { x: 5, y: 0 },
      { x: 5, y: 7 }, { x: 7, y: 0 },
      { x: 6, y: 7 }, { x: 9, y: 0 },
    ]
    out.win = await client.analyze({ moves: winMoves }, 'gomoku', 2000)

    // 案例 3：連珠禁手局面（(7,7) 為三三），輪黑不得踩；用 board 形式測擺譜路徑
    out.renju = await client.analyze(
      {
        board: {
          black: [{ x: 7, y: 6 }, { x: 7, y: 8 }, { x: 6, y: 7 }, { x: 8, y: 7 }],
          white: [{ x: 3, y: 0 }, { x: 5, y: 0 }, { x: 9, y: 0 }, { x: 11, y: 0 }],
          toMove: 1,
        },
      },
      'renju',
      2000,
    )

    client.dispose()
    return out
  })

  console.log(`引擎載入（worker+wasm+40MB 權重+初始化）：${result.loadMs}ms`)
  check('isRapfiSupported() 為 true', result.supported === true)
  check('致謝文字齊備', result.attribution.includes('GPL-3.0') && result.attribution.includes('dhbloo'))

  const { empty, win, renju } = result
  check('案例 1：空盤第一手＝天元 (7,7)', empty.move.x === 7 && empty.move.y === 7, JSON.stringify(empty.move))
  console.log(`  思考 ${empty.timeMs}ms`)
  check(
    '案例 2：建議手成五（2,7 或 7,7）',
    win.move.y === 7 && (win.move.x === 2 || win.move.x === 7),
    JSON.stringify(win.move),
  )
  check('案例 2：evalText=+M1', win.evalText === '+M1', win.evalText)
  check('案例 2：pv 首手＝建議手', win.pv.length >= 1 && win.pv[0].x === win.move.x && win.pv[0].y === win.move.y)
  console.log(`  思考 ${win.timeMs}ms`)
  check('案例 3：renju 輪黑不踩 (7,7) 三三', !(renju.move.x === 7 && renju.move.y === 7), JSON.stringify(renju.move))
  console.log(`  思考 ${renju.timeMs}ms`)

  await browser.close()
} finally {
  server.kill()
}

if (fails.length > 0) {
  console.error(`\nRapfi e2e 失敗 ${fails.length} 項`)
  process.exit(1)
}
console.log('\nRapfi e2e 全數通過')
