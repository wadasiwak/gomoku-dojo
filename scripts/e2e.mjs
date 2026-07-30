// e2e（playwright + vite preview:5311，finally kill）：
//   1. 首頁四入口
//   2. 對弈完整流程：落子 → AI 回手 → 悔棋 → 認輸 → 戰績入庫＋棋譜自動存檔
//   3. renju 禁手點標記出現（__dojo.loadPlay 測試 hook 鋪雙活三前置）
//   4. 題庫：答錯 → 錯題本；答對（引擎判定）→ 通關；重練 → 連對 1
//   5. 棋譜分享 URL 還原一致（round-trip）＋非法棋譜嚴格拒絕
//   6. 自由研棋：重播中停在任一手岔出變化＋AI 建議＋回到棋譜
//   7. 擺譜研究：擺子/清除 → 試下 → AI 建議
//   8. GoatCounter path 只回報 pathname（無 hash/query）
//
//   npm run build && node scripts/e2e.mjs
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { chromium } from 'playwright'
import { findFivePoints } from '../src/engine/vcf.ts'
import { BLACK, WHITE, posOf } from '../src/engine/types.ts'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const PORT = 5311
const BASE = `http://localhost:${PORT}`
const OUT = process.env.OUT ?? '/tmp/gomoku-e2e'
mkdirSync(OUT, { recursive: true })

const puzzlesDoc = JSON.parse(readFileSync(join(ROOT, 'src/puzzles/puzzles.json'), 'utf8'))

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
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
  throw new Error('preview server 起不來')
}

const fails = []
let page
let shotN = 0
async function step(name, fn) {
  try {
    await fn()
    console.log(`✓ ${name}`)
  } catch (e) {
    fails.push({ name, message: e.message })
    console.error(`✗ ${name}：${e.message}`)
    try {
      await page.screenshot({ path: `${OUT}/fail-${++shotN}-${name.replaceAll('/', '_')}.png` })
    } catch {
      /* ignore */
    }
  }
}

const stones = () => page.locator('.goban circle.stone').count()
async function waitStones(n, timeout = 20000) {
  await page.waitForFunction(
    (want) => document.querySelectorAll('.goban circle.stone').length === want,
    n,
    { timeout },
  )
}
const cell = (x, y) => page.locator(`rect[aria-label="(${x},${y})"]`)
const ls = (key) => page.evaluate((k) => localStorage.getItem(k), key)

const solvedVisible = () =>
  page
    .locator('.msg.ok', { hasText: '完成' })
    .isVisible()
    .catch(() => false)

/** 通關一題：照主變化下攻方手（守方由引擎代擋）；主變化若以雙威脅收尾
 *  （line 不含最後成五），從 DOM 讀盤、用引擎找成五點補上最後一手。 */
async function solvePuzzle(puzzle) {
  const attacker = puzzle.attacker === 'black' ? BLACK : WHITE
  const attackerMoves = puzzle.solution.filter((_, i) => i % 2 === 0)
  const waitProgress = (n) =>
    page.waitForFunction(
      (prev) =>
        document.querySelectorAll('.goban circle.stone').length > prev ||
        document.querySelector('.msg.err') !== null,
      n,
      { timeout: 20000 },
    )
  for (const m of attackerMoves) {
    if (await solvedVisible()) return
    const n = await stones()
    await cell(m.x, m.y).click()
    await waitProgress(n)
    if (await page.locator('.msg.err').isVisible().catch(() => false))
      throw new Error(`引擎判錯了正解手 (${m.x},${m.y})`)
  }
  if (await solvedVisible()) return
  const domStones = await page.$$eval('.goban circle.stone', (els) =>
    els.map((c) => ({
      x: Math.round((Number(c.getAttribute('cx')) - 30) / 36),
      y: Math.round((Number(c.getAttribute('cy')) - 30) / 36),
      black: c.classList.contains('black'),
    })),
  )
  const board = new Uint8Array(225)
  for (const s of domStones) board[s.y * 15 + s.x] = s.black ? 1 : 2
  const fives = findFivePoints(board, attacker, puzzle.rule)
  if (fives.length === 0) throw new Error('雙威脅收尾後引擎找不到成五點')
  const p = posOf(fives[0])
  const n = await stones()
  await cell(p.x, p.y).click()
  await waitProgress(n)
  await page.locator('.msg.ok', { hasText: '完成' }).waitFor({ timeout: 20000 })
}

try {
  await waitServer()
  const browser = await chromium.launch()
  page = await browser.newPage({ viewport: { width: 1280, height: 960 } })

  // ---- 1. 首頁 -----------------------------------------------------------
  await step('首頁四入口', async () => {
    await page.goto(`${BASE}/#/`)
    for (const label of ['對弈', '題庫闖關', '棋譜重播', '擺譜研究']) {
      await page.locator('.entry-card h2', { hasText: label }).waitFor({ timeout: 10000 })
    }
  })

  // ---- 2. 對弈流程 --------------------------------------------------------
  await step('對弈：落子→AI 回手→再落→悔棋', async () => {
    await page.goto(`${BASE}/#/play`)
    await page.locator('select[aria-label="AI 難度"]').selectOption('1')
    await cell(7, 7).click()
    await waitStones(2) // AI 回手
    await cell(2, 2).click()
    await waitStones(4)
    await page.locator('button', { hasText: '悔棋' }).click()
    await waitStones(2) // 撤 AI 一手＋自己一手
  })

  await step('對弈：認輸→戰績入庫＋棋譜自動存檔', async () => {
    await page.locator('button', { hasText: '認輸' }).click()
    await page.locator('.status.final').waitFor({ timeout: 5000 })
    const stats = JSON.parse(await ls('gomoku-dojo-stats-v1'))
    if (!stats['renju-L1'] || stats['renju-L1'].loss < 1)
      throw new Error(`戰績未入庫：${JSON.stringify(stats)}`)
    const records = JSON.parse(await ls('gomoku-dojo-records-v1'))
    if (!Array.isArray(records) || records.length < 1) throw new Error('棋譜未自動存檔')
    await page.screenshot({ path: `${OUT}/play-endgame.png` })
  })

  // ---- 3. renju 禁手標記 --------------------------------------------------
  await step('renju 禁手點標記（雙活三 → (7,7) ✕）', async () => {
    await page.goto(`${BASE}/#/play`)
    await page.waitForFunction(() => !!window.__dojo, undefined, { timeout: 10000 })
    const okLoad = await page.evaluate(() => window.__dojo.loadPlay('r1:fhaaghbahfcahgda'))
    if (!okLoad) throw new Error('__dojo.loadPlay 拒絕了測試棋譜')
    await page.locator('.fb-mark[data-fb="7,7"]').waitFor({ timeout: 15000 })
    await page.screenshot({ path: `${OUT}/forbidden-marks.png` })
  })

  // ---- 4. 題庫 ------------------------------------------------------------
  const puzzle = puzzlesDoc.puzzles.find((p) => p.vcfDepth === 2)
  if (!puzzle) throw new Error('題庫沒有深度 2 的題（e2e 需要）')
  // 找一個遠離所有棋子與解答的空角落當「錯手」
  const taken = new Set()
  const body = puzzle.record.split(':')[1]
  const A = 'a'.charCodeAt(0)
  for (let i = 0; i < body.length; i += 2)
    taken.add(`${body.charCodeAt(i) - A},${body.charCodeAt(i + 1) - A}`)
  const wrongCorner = [
    [0, 0],
    [14, 0],
    [0, 14],
    [14, 14],
  ].find(([cx, cy]) => {
    for (const t of taken) {
      const [sx, sy] = t.split(',').map(Number)
      if (Math.max(Math.abs(sx - cx), Math.abs(sy - cy)) <= 4) return false
    }
    return !puzzle.solution.some((m) => m.x === cx && m.y === cy)
  })

  await step('題庫：答錯 → 判錯＋進錯題本', async () => {
    await page.goto(`${BASE}/#/puzzle/${puzzle.id}`)
    await page.locator('.goban').waitFor()
    await cell(wrongCorner[0], wrongCorner[1]).click()
    await page.locator('.msg.err').waitFor({ timeout: 20000 })
    const prog = JSON.parse(await ls('gomoku-dojo-puzzles-v1'))
    if (!prog.wrong[puzzle.id]) throw new Error('錯題未進錯題本')
    await page.screenshot({ path: `${OUT}/puzzle-wrong.png` })
  })

  await step('題庫：答對（衝四→引擎回擋→收官）→ 通關', async () => {
    await solvePuzzle(puzzle)
    const prog = JSON.parse(await ls('gomoku-dojo-puzzles-v1'))
    if (!prog.solved[puzzle.id]) throw new Error('通關未記錄')
    if (!prog.wrong[puzzle.id]) throw new Error('本次有錯，應留在錯題本')
    await page.screenshot({ path: `${OUT}/puzzle-solved.png` })
  })

  await step('錯題本：列出→重練（無錯通關）→ 連對 1', async () => {
    await page.goto(`${BASE}/#/puzzles/wrong`)
    await page.locator('.puzzle-card', { hasText: puzzle.id }).waitFor({ timeout: 5000 })
    await page.locator('.puzzle-card', { hasText: puzzle.id }).click()
    await page.locator('.goban').waitFor()
    await solvePuzzle(puzzle)
    const prog = JSON.parse(await ls('gomoku-dojo-puzzles-v1'))
    if (!prog.wrong[puzzle.id] || prog.wrong[puzzle.id].streak !== 1)
      throw new Error(`連對計數不對：${JSON.stringify(prog.wrong[puzzle.id])}`)
  })

  // ---- 5. 棋譜分享還原 ----------------------------------------------------
  await step('棋譜分享 URL 還原一致（round-trip）', async () => {
    await page.goto(`${BASE}/#/replay/r1:hhhgii`)
    await waitStones(3)
    const rt = await page.locator('[data-record]').getAttribute('data-record')
    if (rt !== 'r1:hhhgii') throw new Error(`round-trip 不一致：${rt}`)
    await page.locator('button', { hasText: '◀' }).click()
    await waitStones(2)
  })

  await step('非法棋譜（重複落子）嚴格拒絕', async () => {
    await page.goto(`${BASE}/#/replay/r1:hhhh`)
    await page.locator('.msg.err', { hasText: '無效' }).waitFor({ timeout: 5000 })
  })

  // ---- 6. 自由研棋 ---------------------------------------------------------
  await step('自由研棋：重播停在任一手→岔出變化→AI 建議→回到棋譜', async () => {
    await page.goto(`${BASE}/#/replay/r1:hhhgii`)
    await waitStones(3)
    await page.locator('button', { hasText: '◀' }).click()
    await waitStones(2) // 停在第 2 手，輪黑
    await cell(0, 0).click() // 岔出變化
    await waitStones(3)
    await page.locator('.status', { hasText: '研棋中' }).waitFor({ timeout: 5000 })
    await page.locator('button', { hasText: 'AI 建議' }).click()
    await page.locator('.hint-mark').waitFor({ timeout: 20000 })
    await page.screenshot({ path: `${OUT}/replay-trial.png` })
    await page.locator('button', { hasText: '回到棋譜' }).click()
    await waitStones(2) // 變化收掉、回到純重播
    const rt = await page.locator('[data-record]').getAttribute('data-record')
    if (rt !== 'r1:hhhgii') throw new Error(`研棋污染了原棋譜：${rt}`)
  })

  // ---- 7. 擺譜研究 ---------------------------------------------------------
  await step('擺譜研究：擺子/清除→試下→AI 建議', async () => {
    await page.goto(`${BASE}/#/study`)
    await page.locator('.goban').waitFor()
    await cell(7, 7).click() // 黑子
    await page.locator('button', { hasText: '白子' }).click()
    await cell(8, 8).click() // 白子
    await cell(9, 9).click() // 白子（待清除）
    await waitStones(3)
    await page.locator('button', { hasText: '清除' }).click()
    await cell(9, 9).click()
    await waitStones(2)
    await page.locator('button', { hasText: '開始試下' }).click()
    await page.locator('.status', { hasText: '試下中' }).waitFor({ timeout: 5000 })
    await cell(7, 8).click() // 試下第 1 手（黑）
    await waitStones(3)
    await page.locator('button', { hasText: 'AI 建議' }).click()
    await page.locator('.hint-mark').waitFor({ timeout: 20000 })
    await page.screenshot({ path: `${OUT}/study-hint.png` })
    await page.locator('button', { hasText: '悔一手' }).click()
    await waitStones(2)
  })

  // ---- 8. GoatCounter path ------------------------------------------------
  await step('GoatCounter path 無 hash/query', async () => {
    await page.goto(`${BASE}/#/replay/r1:hhhgii`)
    const p = await page.evaluate(() => window.goatcounter.path())
    if (p !== '/' || p.includes('#') || p.includes('?'))
      throw new Error(`analytics path 洩漏 hash/query：${p}`)
  })

  await browser.close()
} finally {
  server.kill()
}

console.log('')
if (fails.length > 0) {
  console.error(`✗ e2e ${fails.length} 項失敗（截圖在 ${OUT}）`)
  process.exit(1)
}
console.log('✓ e2e 全數通過')
