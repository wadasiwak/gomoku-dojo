// e2e（playwright + vite preview:5311，finally kill）：
//   1. 首頁四入口
//   2. 對弈完整流程：落子 → AI 回手 → 悔棋 → 認輸 → 戰績入庫＋棋譜自動存檔
//   3. renju 禁手點標記出現（__dojo.loadPlay 測試 hook 鋪雙活三前置）
//   4. 題庫：答錯 → 錯題本；答對（引擎判定）→ 通關；重練 → 連對 1
//   5. 棋譜分享 URL 還原一致（round-trip）＋非法棋譜嚴格拒絕
//   6. 自由研棋：重播中停在任一手岔出變化＋AI 建議＋回到棋譜
//   7. 擺譜研究：擺子（輪流預設）/清除 → 試下（分析統一走 Rapfi）
//   8. 開局圖鑑：26 卡片牆 → 詳情 → 用此開局對弈；猜名練習答對計分
//   9. RIF 正式規約：AI 擺開局→換邊決定→白4→兩打→擇打→正常輪替；
//      r2 棋譜 round-trip／竄改拒絕／悔棋規約下限；
//      兩打迴歸（名月+I10 書外局面）：Rapfi 決策來源、不含 H7、兩點 node 端深驗
//  10. GoatCounter path 只回報 pathname（無 hash/query）
//  11. 匯入棋譜：座標序列（容錯分隔）→重播；非法行內指出第幾手；擺譜頁載入
//  12. 資源頁：三站外連＋關係聲明＋footer Rapfi 致謝
//  13. Rapfi 分析：載入引擎（40MB 本機快取，timeout 放寬 120s）→建議 hint＋結果
//
//   npm run build && node scripts/e2e.mjs
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { chromium } from 'playwright'
import { findFivePoints } from '../src/engine/vcf.ts'
import { BLACK, WHITE, posOf } from '../src/engine/types.ts'
import {
  buildBoardCommand,
  buildThinkSetup,
  movesToStones,
  parseEngineLine,
  evalTextToScore,
} from '../src/analysis/protocol.ts'

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

// ---- node 端 Rapfi（規約兩打深驗用；與 scripts/rapfi-smoke.mjs 同載入手法）----
let nodeRapfi = null
async function nodeRapfiEngine() {
  if (nodeRapfi) return nodeRapfi
  const require = createRequire(import.meta.url)
  const DIR = join(ROOT, 'public', 'rapfi') + '/'
  const file = DIR + 'rapfi-single-simd128.js'
  // repo 是 "type": "module"，Emscripten glue 要以 CJS 語意手動執行
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', '__dirname', '__filename', readFileSync(file, 'utf8'))(
    mod,
    mod.exports,
    require,
    DIR,
    file,
  )
  const events = []
  const engine = await mod.exports({
    locateFile: (url) => DIR + url,
    onReceiveStdout: (line) => events.push(parseEngineLine(line)),
    onReceiveStderr: () => {},
    onExit: () => {},
  })
  engine.sendCommand('START 15')
  nodeRapfi = { engine, events }
  return nodeRapfi
}

/** moves（黑先交替）局面 think：回傳 { move, score }（score＝待思考方視角數值）。 */
async function nodeRapfiThink(moves, ms) {
  const { engine, events } = await nodeRapfiEngine()
  events.length = 0
  const toMove = moves.length % 2 === 0 ? BLACK : WHITE
  const cmds = [...buildThinkSetup('renju', ms), buildBoardCommand(movesToStones(moves), toMove)]
  for (const c of cmds) engine.sendCommand(c) // 單執行緒 build：sendCommand 同步想完
  let move = null
  let evalText
  for (const e of events) {
    if (e.kind === 'move') move = e.pos
    else if (e.kind === 'eval') evalText = e.text
  }
  return { move, score: evalTextToScore(evalText) ?? 0 }
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
/** AI 連續快速回手時 count 可能一口氣跳兩格，等「至少 n」而非恰等於 n。 */
async function waitStonesAtLeast(n, timeout = 25000) {
  await page.waitForFunction(
    (want) => document.querySelectorAll('.goban circle.stone').length >= want,
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
  // locale 固定 zh-TW：站台會依 navigator.language 自動切英/日文，選擇器都是中文
  page = await browser.newPage({ viewport: { width: 1280, height: 960 }, locale: 'zh-TW' })

  // ---- 1. 首頁 -----------------------------------------------------------
  await step('首頁五入口', async () => {
    await page.goto(`${BASE}/#/`)
    for (const label of ['對弈', '題庫闖關', '棋譜重播', '擺譜研究', '開局圖鑑']) {
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
  await step('擺譜研究：一黑一白依序落子→編號→退一手→無工具列', async () => {
    await page.goto(`${BASE}/#/study`)
    await page.locator('.goban').waitFor()
    await cell(7, 7).click() // 黑
    await cell(6, 6).click() // 白
    await cell(8, 8).click() // 黑
    if ((await page.locator('.stone.white').count()) !== 1) throw new Error('第二手應為白子')
    if ((await page.locator('.stone.black').count()) !== 2) throw new Error('應有兩顆黑子')
    await cell(8, 8).click() // 點已有子＝不動作（打譜不拿子，退回用右鍵/退一手）
    await waitStones(3)
    await page.locator('.status b', { hasText: '輪白（第 4 手）' }).waitFor({ timeout: 3000 })
    await page.locator('button', { hasText: '退一手' }).click()
    await waitStones(2)
    for (const gone of ['開始試下', '黑子', '白子', 'AI 建議'])
      if ((await page.locator('.panel button', { hasText: gone }).count()) !== 0)
        throw new Error(`擺譜頁不應再有「${gone}」`)
    if ((await page.locator('select[aria-label="接下來輪誰"]').count()) !== 0)
      throw new Error('擺譜頁不應再有「接下來輪誰」')
  })

  await step('擺譜存檔：取名存檔→清空→從清單開啟→更新→刪除', async () => {
    await page.goto(`${BASE}/#/study`)
    page.once('dialog', () => {}) // 保險
    await page.evaluate(() => localStorage.removeItem('gomoku-dojo-studies-v1'))
    await page.reload()
    for (const [x, y] of [[7, 7], [8, 6], [6, 8]]) await cell(x, y).click()
    await page.locator('input[aria-label="存檔名稱"]').fill('丘月研究')
    await page.locator('button', { hasText: '存成新檔' }).click()
    await page.locator('.msg.ok', { hasText: '已存檔「丘月研究」（3 手）' }).waitFor({ timeout: 3000 })
    await page.locator('button', { hasText: '清空盤面' }).click()
    await waitStones(0)
    await page.locator('.study-open', { hasText: '丘月研究' }).click()
    await waitStones(3)
    await cell(9, 9).click() // 第 4 手
    await page.locator('button', { hasText: '更新「丘月研究」' }).click()
    await page.locator('.study-open', { hasText: '4 手' }).waitFor({ timeout: 3000 })
    await page.reload() // 重新整理後仍在
    await page.locator('.study-open', { hasText: '丘月研究' }).waitFor({ timeout: 3000 })
    page.once('dialog', (d) => d.accept())
    await page.locator('button[aria-label="刪除 丘月研究"]').click()
    if ((await page.locator('.study-open').count()) !== 0) throw new Error('刪除後清單應為空')
  })

  // ---- 8. 開局圖鑑 ----------------------------------------------------------
  await step('開局圖鑑：26 卡片→詳情→用此開局對弈', async () => {
    await page.goto(`${BASE}/#/openings`)
    await page.locator('.opening-card').first().waitFor({ timeout: 10000 })
    const n = await page.locator('.opening-card').count()
    if (n !== 26) throw new Error(`卡片數 ${n} ≠ 26`)
    for (const name of ['寒星', '浦月', '彗星']) {
      if (!(await page.locator('.opening-card h3', { hasText: name }).isVisible()))
        throw new Error(`找不到珠型卡片：${name}`)
    }
    await page.locator('.opening-card h3', { hasText: '浦月' }).click()
    await page.locator('.opening-detail').waitFor({ timeout: 5000 })
    await page.screenshot({ path: `${OUT}/opening-detail.png` })
    await page.locator('button', { hasText: '用此開局對弈' }).click()
    // 前三手已鋪上對弈盤；白手番輪 AI、可能很快補上第 4 手 → 用 >=3 斷言
    await page.waitForFunction(
      () => document.querySelectorAll('.goban circle.stone').length >= 3,
      undefined,
      { timeout: 20000 },
    )
  })

  await step('開局猜名：答對計分→下一題', async () => {
    await page.goto(`${BASE}/#/openings/guess`)
    await page.locator('.guess-opt').first().waitFor({ timeout: 10000 })
    const nOpt = await page.locator('.guess-opt').count()
    if (nOpt !== 4) throw new Error(`選項數 ${nOpt} ≠ 4`)
    const answer = await page.evaluate(() => window.__dojo.guessAnswer())
    await page.locator('.guess-opt', { hasText: answer }).click()
    await page.locator('.msg.ok', { hasText: '答對' }).waitFor({ timeout: 5000 })
    await page.locator('.page-head', { hasText: '1 / 1' }).waitFor({ timeout: 5000 })
    await page.locator('button', { hasText: '下一題' }).click()
    await page.locator('.guess-opt').first().waitFor({ timeout: 5000 })
  })

  // ---- 9. RIF 正式規約 -------------------------------------------------------
  await step('規約對弈：AI 擺開局→不換邊→白4→AI 兩打→白擇打→正常輪替', async () => {
    await page.goto(`${BASE}/#/play`)
    await page.locator('select[aria-label="AI 難度"]').selectOption('1')
    await page.locator('select[aria-label="對局模式"]').selectOption('rif')
    await page.locator('select[aria-label="先後手"]').selectOption('white') // 我是暫白
    await waitStones(3) // AI（暫黑）擺完 26 珠型前三手
    await page.locator('button', { hasText: '不換邊' }).click()
    await page.locator('.status', { hasText: '第 4 手' }).waitFor({ timeout: 5000 })
    await cell(1, 1).click() // 白4 任意空點（遠離中央開局區）
    // 白4 (1,1) 必為書外 → AI 兩打走 Rapfi 即時決策；首載 40MB（本機）放寬 timeout
    await page.locator('.pt-mark').first().waitFor({ timeout: 150000 }) // AI 兩打 A/B
    const nMarks = await page.locator('.pt-mark').count()
    if (nMarks !== 2) throw new Error(`兩打標記數 ${nMarks} ≠ 2`)
    await page.screenshot({ path: `${OUT}/rif-offers.png` })
    const pos = await page.locator('.pt-mark').first().getAttribute('data-pos')
    const [mx, my] = pos.split(',').map(Number)
    await cell(mx, my).click() // 白擇打
    await waitStones(5)
    await page.locator('.status', { hasText: '輪到你落子' }).waitFor({ timeout: 5000 })
    const info = await page.locator('.rif-info').innerText()
    if (!/開局：/.test(info)) throw new Error(`規約紀錄缺開局名稱：${info}`)
    if (!/兩打：A/.test(info)) throw new Error(`規約紀錄缺兩打資訊：${info}`)
    await cell(13, 13).click() // 白6（遠離所有子與兩打候選區）
    await waitStones(7, 25000) // AI（黑）第 7 手回手
  })

  await step('規約對弈（暫黑視角）：擺彗星→AI 不換邊→AI 白4→人兩打→AI 擇打', async () => {
    await page.goto(`${BASE}/#/play`)
    await page.locator('select[aria-label="先後手"]').selectOption('black') // 我是暫黑
    await page.locator('select[aria-label="對局模式"]').selectOption('rif')
    await page.locator('button', { hasText: '重開' }).click()
    // 擺彗星（i13，主流白大優 → AI 依珠型評價必不換邊，路徑決定性）
    await cell(7, 7).click()
    await cell(8, 6).click()
    await cell(5, 9).click()
    await waitStones(3)
    // AI（暫白）決定不換邊 → 直接搜索白 4
    await page.locator('.rif-info', { hasText: '不換邊' }).waitFor({ timeout: 15000 })
    await waitStonesAtLeast(4) // AI 白 4
    // 黑方（我）兩打：挑兩個未被占用的空點
    await page.locator('.status', { hasText: '兩打' }).waitFor({ timeout: 5000 })
    const taken = await page.$$eval('.goban circle.stone', (els) =>
      els.map((c) => [
        Math.round((Number(c.getAttribute('cx')) - 30) / 36),
        Math.round((Number(c.getAttribute('cy')) - 30) / 36),
      ]),
    )
    const free = [
      [6, 8],
      [9, 9],
      [4, 4],
      [10, 4],
      [4, 10],
    ].filter(([x, y]) => !taken.some(([tx, ty]) => tx === x && ty === y))
    await cell(free[0][0], free[0][1]).click()
    await cell(free[1][0], free[1][1]).click()
    await page.locator('button', { hasText: '確定兩打' }).click()
    // AI（白）擇打成立第 5 手後緊接搜索第 6 手，兩步可能連跳 → 等至少 6。
    // 擇打書 miss 時走 Rapfi（兩點各短 think），timeout 放寬。
    await waitStonesAtLeast(6, 120000)
    const info = await page.locator('.rif-info').innerText()
    if (!/彗星/.test(info)) throw new Error(`規約紀錄應含彗星：${info}`)
    if (!/AI（白）擇/.test(info)) throw new Error(`規約紀錄缺 AI 擇打說明：${info}`)
  })

  const RIF_REC = 'r2:hhigiijggill:oi7s0tgijj' // 浦月、不換邊、兩打 (6,8)/(9,9) 擇 A，6 手
  await step('規約棋譜 r2：重播 round-trip＋規約標示', async () => {
    await page.goto(`${BASE}/#/replay/${RIF_REC}`)
    await waitStones(6)
    const rt = await page.locator('[data-record]').getAttribute('data-record')
    if (rt !== RIF_REC) throw new Error(`round-trip 不一致：${rt}`)
    await page.locator('.status', { hasText: '正式規約' }).waitFor({ timeout: 5000 })
    await page.locator('.status', { hasText: '浦月' }).waitFor({ timeout: 5000 })
  })

  await step('規約棋譜 r2：竄改（開局 id 不符）嚴格拒絕', async () => {
    await page.goto(`${BASE}/#/replay/r2:hhigiijggill:od4s0tgijj`)
    await page.locator('.msg.err', { hasText: '無效' }).waitFor({ timeout: 5000 })
  })

  await step('規約悔棋下限：悔到第 5 手成立點即止', async () => {
    // 8 手規約譜（我執黑、無換邊）：悔一次 8→6，再悔會穿過第 5 手 → 按鈕停用
    const rec8 = 'r2:hhigiijggillmmlm:oi7s0tgijj'
    await page.goto(`${BASE}/#/play`)
    await page.waitForFunction(() => !!window.__dojo, undefined, { timeout: 10000 })
    const ok = await page.evaluate(
      (r) => window.__dojo.loadPlay(r, { player: 'black' }),
      rec8,
    )
    if (!ok) throw new Error('loadPlay 拒絕了合法 r2 棋譜')
    await waitStones(8)
    await page.locator('button', { hasText: '悔棋' }).click()
    await waitStones(6)
    const disabled = await page.locator('button', { hasText: '悔棋' }).isDisabled()
    if (!disabled) throw new Error('悔棋應在觸及規約下限（第 5 手）後停用')
  })

  // 名月（H8 I9 G6）＋白4 I10：書外局面（書只收每開局白4 top-3 分支）。
  // 2026-07 國手實戰迴歸：舊靜態 eval 決策在此提出 I8/H7，H7 真值 −M19（白必勝）。
  const MEIGETSU_I10 = 'r2:hhiggjif:oi12s0'
  const MEIGETSU_I10_MOVES = [
    { x: 7, y: 7 },
    { x: 8, y: 6 },
    { x: 6, y: 9 },
    { x: 8, y: 5 },
  ]
  let offeredPair = null // 兩打座標，交給下一步 node 端深驗
  await step('規約兩打迴歸（名月+I10 書外）：Rapfi 決策來源＋不含 H7', async () => {
    await page.goto(`${BASE}/#/play`)
    await page.waitForFunction(() => !!window.__dojo, undefined, { timeout: 10000 })
    const ok = await page.evaluate(
      (r) => window.__dojo.loadPlay(r, { player: 'white' }),
      MEIGETSU_I10,
    )
    if (!ok) throw new Error('loadPlay 拒絕了名月+I10 規約譜')
    // 書 miss → AI（黑）走 Rapfi 即時決策提兩打（此瀏覽器 session 可能首載 40MB，放寬）
    await page.locator('.pt-mark').first().waitFor({ timeout: 150000 })
    const marks = await page.$$eval('.pt-mark', (els) =>
      els.map((e) => e.getAttribute('data-pos')),
    )
    if (marks.length !== 2) throw new Error(`兩打標記數 ${marks.length} ≠ 2`)
    if (marks.includes('7,8')) throw new Error(`兩打含被殺穿的 H7：${marks.join(' / ')}`)
    const note = await page.locator('.rif-info').innerText()
    if (!/兩打（Rapfi）/.test(note)) throw new Error(`決策來源未標示 Rapfi：${note}`)
    await page.screenshot({ path: `${OUT}/rif-offer-rapfi.png` })
    offeredPair = marks.map((s) => {
      const [x, y] = s.split(',').map(Number)
      return { x, y }
    })
  })

  await step('規約兩打迴歸：兩點 node 端 Rapfi 短驗（黑視角 > −5000）', async () => {
    if (!offeredPair) throw new Error('前一步未取得兩打，無從深驗')
    for (const p of offeredPair) {
      // 落黑子後白手番 think 3s → 黑視角＝白視角取負；−5000 已寬（−M 級 ≈ −30000）
      const r = await nodeRapfiThink([...MEIGETSU_I10_MOVES, p], 3000)
      const blackView = -r.score
      console.log(`    兩打 (${p.x},${p.y}) Rapfi 3s 黑視角 ${blackView}`)
      if (blackView <= -5000)
        throw new Error(`兩打 (${p.x},${p.y}) 深驗黑視角 ${blackView} ≤ −5000（提了被殺穿的點）`)
    }
  })

  // ---- 10. GoatCounter path ------------------------------------------------
  await step('GoatCounter path 無 hash/query', async () => {
    await page.goto(`${BASE}/#/replay/r1:hhhgii`)
    const p = await page.evaluate(() => window.goatcounter.path())
    if (p !== '/' || p.includes('#') || p.includes('?'))
      throw new Error(`analytics path 洩漏 hash/query：${p}`)
  })

  // ---- 11. 匯入棋譜 ----------------------------------------------------------
  await step('匯入棋譜：座標序列（大小寫/逗號/換行容錯）→ 重播', async () => {
    await page.goto(`${BASE}/#/replay`)
    await page.locator('.import-box textarea').waitFor({ timeout: 5000 })
    await page.locator('.import-box textarea').fill('H8, i9\ng9')
    await page.locator('button', { hasText: '匯入重播' }).click()
    await waitStones(3)
    const rt = await page.locator('[data-record]').getAttribute('data-record')
    if (rt !== 'r1:hhiggg') throw new Error(`匯入序列化不對：${rt}`)
    await page.screenshot({ path: `${OUT}/import-ok.png` })
  })

  await step('匯入棋譜：非法（重複落子）行內指出第幾手', async () => {
    await page.goto(`${BASE}/#/replay`)
    await page.locator('.import-box textarea').waitFor({ timeout: 5000 })
    await page.locator('.import-box textarea').fill('h8 i9 h8')
    await page.locator('button', { hasText: '匯入重播' }).click()
    await page.locator('.import-err', { hasText: '第 3 手' }).waitFor({ timeout: 5000 })
    await page.screenshot({ path: `${OUT}/import-err.png` })
  })

  await step('匯入棋譜：擺譜頁載入 → 盤面鋪好', async () => {
    await page.goto(`${BASE}/#/study`)
    await page.locator('.import-box textarea').waitFor({ timeout: 5000 })
    await page.locator('.import-box textarea').fill('r1:hhhgii')
    await page.locator('button', { hasText: '載入擺譜' }).click()
    await waitStones(3)
    await page.locator('.status', { hasText: '輪白（第 4 手）' }).waitFor({ timeout: 5000 })
  })

  // ---- 12. 資源頁 ------------------------------------------------------------
  await step('資源頁：nav 入口＋三站外連＋關係聲明', async () => {
    await page.goto(`${BASE}/#/`)
    await page.locator('nav a', { hasText: '資源' }).click()
    await page.locator('.res-card').first().waitFor({ timeout: 5000 })
    for (const host of ['renju.net', '587.renju.org.tw', 'gomocalc.com']) {
      const n = await page.locator(`.res-card a[href*="${host}"]`).count()
      if (n < 1) throw new Error(`缺外連：${host}`)
    }
    await page.locator('.res-note', { hasText: '未使用 renju.net' }).waitFor({ timeout: 5000 })
    await page.screenshot({ path: `${OUT}/resources.png` })
  })

  await step('footer Rapfi 致謝（GPL-3.0＋原始碼連結）', async () => {
    await page.locator('.foot-attr', { hasText: 'GPL-3.0' }).waitFor({ timeout: 5000 })
    await page.locator('.foot-attr a[href*="github.com/dhbloo/rapfi"]').waitFor({ timeout: 5000 })
  })

  // ---- 13. Rapfi 分析 --------------------------------------------------------
  await step('Rapfi 分析：載入引擎→建議路線＋評分/PV（首載 40MB 走本機）', async () => {
    await page.goto(`${BASE}/#/replay/r1:hhhgii`)
    await waitStones(3)
    await page.locator('select[aria-label="Rapfi 思考時間"]').selectOption('1000')
    await page.locator('button', { hasText: 'Rapfi 分析' }).click()
    await page.locator('.rapfi-result').waitFor({ timeout: 120000 })
    await page.locator('[data-pv="1"]').waitFor({ timeout: 5000 })
    const txt = await page.locator('.rapfi-result').innerText()
    if (!/Rapfi 建議：/.test(txt)) throw new Error(`結果缺建議手：${txt}`)
    await page.screenshot({ path: `${OUT}/rapfi-analysis.png` })
  })

  await step('Rapfi 分析：擺譜也拿得到建議（手順輸入）', async () => {
    await page.goto(`${BASE}/#/study/r1:hhhgii`)
    await waitStones(3)
    await page.locator('select[aria-label="Rapfi 思考時間"]').selectOption('1000')
    await page.locator('button', { hasText: 'Rapfi 分析' }).click()
    // 引擎已載入（上一步），這裡只等思考
    await page.locator('.rapfi-result').waitFor({ timeout: 60000 })
    await page.locator('[data-pv="1"]').waitFor({ timeout: 5000 })
    await page.screenshot({ path: `${OUT}/rapfi-study.png` })
  })

  await step('Rapfi 建議路線：棋盤顯示編號路線→照第一手下仍保留→走別的收掉', async () => {
    await page.goto(`${BASE}/#/study/r1:hhhgiiggjk`)
    await page.locator('select[aria-label="Rapfi 思考時間"]').selectOption('1000')
    await page.locator('select[aria-label="建議路線顯示手數"]').selectOption('6')
    await page.locator('button', { hasText: 'Rapfi 分析' }).click()
    await page.locator('.rapfi-result').waitFor({ timeout: 60000 })
    const pvs = () =>
      page.locator('[data-pv]').evaluateAll((els) => els.map((e) => e.getAttribute('data-pos')))
    const line = await pvs()
    if (line.length < 2 || line.length > 6) throw new Error(`路線手數不對：${line.length}`)
    const [x, y] = line[0].split(',').map(Number)
    await cell(x, y).click() // 擺譜（輪流擺）照建議下第一手
    const after = await pvs()
    if (after[0] !== line[1]) throw new Error(`照走後路線沒前進：${after[0]} vs ${line[1]}`)
    if ((await page.locator('.rapfi-result').count()) !== 1) throw new Error('照走後分析結果被清掉')
    await cell(0, 0).click() // 偏離
    if ((await pvs()).length !== 0) throw new Error('偏離後路線沒收掉')
    await page.locator('select[aria-label="建議路線顯示手數"]').selectOption('1') // 還原預設
  })

  await step('擺譜：右鍵退回 → Rapfi 收到實際手順 → 照路線走後再分析', async () => {
    await page.goto(`${BASE}/#/study`)
    const nums = () => page.locator('.goban g:not(.pv-stone) > .stone-n').allTextContents()
    for (const [x, y] of [[7, 7], [8, 6], [6, 8], [9, 5]]) await cell(x, y).click()
    if ((await nums()).length !== 4) throw new Error(`4 手應有 4 個編號：${await nums()}`)
    await cell(3, 3).click({ button: 'right' }) // 右鍵＝退回第 4 手
    const after = await nums()
    if (after.length !== 3 || after.includes('4')) throw new Error(`右鍵沒退回：${after}`)
    await page.locator('select[aria-label="Rapfi 思考時間"]').selectOption('1000')
    await page.locator('button', { hasText: 'Rapfi 分析' }).click()
    await page.locator('.rapfi-result').waitFor({ timeout: 60000 })
    // 照建議下一手 → 再分析一次（曾因清錨點自我取消而沒結果）
    const [nx, ny] = (await page.locator('[data-pv="1"]').getAttribute('data-pos')).split(',').map(Number)
    await cell(nx, ny).click()
    if ((await nums()).length !== 4) throw new Error('編號沒接續')
    await page.locator('button', { hasText: 'Rapfi 分析' }).click()
    await page.locator('.rapfi-result').waitFor({ timeout: 60000 })
  })

  await step('重播：右鍵回到上一手', async () => {
    await page.goto(`${BASE}/#/replay/r1:hhhgiigg`)
    await waitStones(4)
    await cell(3, 3).click({ button: 'right' })
    await waitStones(3)
  })

  // ---- 14. 名人賽特訓（塔拉山口-10 vs Rapfi） ---------------------------------
  const taraCfg = (patch) =>
    page.evaluate(
      (p) =>
        localStorage.setItem(
          'gomoku-dojo-tara-v1',
          JSON.stringify({ seat: 'first', strength: 'd6', timeControl: 'none', showForbidden: true, showEval: true, ...p }),
        ),
      patch,
    )
  const taraStatus = () => page.locator('.status b').innerText()
  async function waitTaraStatus(re, timeout = 60000) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      if (re.test(await taraStatus())) return
      await page.waitForTimeout(200)
    }
    throw new Error(`狀態列等不到 ${re}：「${await taraStatus()}」`)
  }

  await step('特訓：nav 入口→天元限制→AI 交換決定（Rapfi 評估）', async () => {
    await page.goto(`${BASE}/#/`)
    await taraCfg({})
    await page.locator('nav a', { hasText: '特訓' }).click()
    await waitTaraStatus(/天元/)
    await cell(6, 7).click() // 非天元 → 擋
    await page.locator('.msg.err', { hasText: '天元' }).waitFor({ timeout: 3000 })
    await cell(7, 7).click()
    // AI（白方持有者）決定交換後輪到人（若 AI 換了，人執白下第 2 手；否則人等 AI 下第 2 手）
    await waitTaraStatus(/輪到你下第|你決定是否交換/, 120000)
    const notes = await page.locator('.rif-info p').allInnerTexts()
    if (!notes.some((t) => /交換/.test(t))) throw new Error(`缺 AI 交換紀錄：${notes}`)
  })

  await step('特訓：人方十打（對稱等價擋下、滿 10 提示）→ AI 擇一 → AI 下第 6 手', async () => {
    await page.goto(`${BASE}/#/tara`)
    await taraCfg({})
    await page.reload()
    await page.waitForFunction(() => window.__dojo?.loadTara)
    // 左右對稱局面：黑 H8、白 H7、黑 H9、白 H5；人執黑已選十打
    await page.evaluate(() =>
      window.__dojo.loadTara({
        moves: [{ x: 7, y: 7 }, { x: 7, y: 8 }, { x: 7, y: 6 }, { x: 7, y: 10 }],
        meta: { swaps: [false, false, false], branch: 'ten', offers: null },
      }),
    )
    await waitTaraStatus(/十打：點選/)
    await cell(6, 7).click()
    await cell(8, 7).click() // 與 G8 鏡射等價
    await page.locator('.msg.err', { hasText: '對稱等價' }).waitFor({ timeout: 3000 })
    for (const [x, y] of [[6, 6], [6, 8], [5, 7], [6, 5], [6, 9], [5, 6], [5, 8], [4, 7], [6, 4], [6, 10]])
      await cell(x, y).click()
    await page.locator('.msg.err', { hasText: '已選滿' }).waitFor({ timeout: 3000 })
    if ((await page.locator('[data-mark]').count()) !== 10) throw new Error('十打標記數不是 10')
    await page.locator('button', { hasText: '確定十打' }).click()
    await waitTaraStatus(/輪到你落子/, 120000)
    if ((await stones()) !== 6) throw new Error(`應有 6 子，實際 ${await stones()}`)
    await page.locator('.rif-info', { hasText: 'AI 從十打中擇' }).waitFor({ timeout: 3000 })
  })

  await step('特訓：白 4 後人方三選一 → ③持白 → AI 下黑 5 → 人最後選黑白', async () => {
    await page.goto(`${BASE}/#/tara`)
    await taraCfg({})
    await page.reload()
    await page.waitForFunction(() => window.__dojo?.loadTara)
    // 前四手已下、三次都不換 → 人（下第 1 手者）執黑，輪到三選一
    await page.evaluate(() =>
      window.__dojo.loadTara({
        moves: [{ x: 7, y: 7 }, { x: 7, y: 8 }, { x: 8, y: 6 }, { x: 4, y: 4 }],
        meta: { swaps: [false, false, false], branch: null, offers: null },
      }),
    )
    await waitTaraStatus(/三選一/)
    for (const t of ['① 十打', '② 持黑', '③ 持白'])
      await page.locator('.btn-col button', { hasText: t }).waitFor({ timeout: 3000 })
    await page.locator('.btn-col button', { hasText: '③ 持白' }).click()
    await waitTaraStatus(/黑 5 已下：你最後選黑白（目前你執白）/, 120000)
    if ((await stones()) !== 5) throw new Error(`應有 5 子，實際 ${await stones()}`)
    await page.locator('button', { hasText: '我選執白' }).click()
    await waitTaraStatus(/輪到你落子|等待 Rapfi|思考/, 60000)
  })

  await step('特訓：棋鐘走秒＋超時判負＋棋譜庫標示', async () => {
    // 獨立 page＋假時鐘（不污染共用 page 的計時器）：快轉 5 分鐘 → 人方超時判負
    const p2 = await browser.newPage({ locale: 'zh-TW' })
    try {
      await p2.clock.install()
      await p2.goto(`${BASE}/#/tara`)
      await p2.evaluate(() =>
        localStorage.setItem(
          'gomoku-dojo-tara-v1',
          JSON.stringify({ seat: 'first', strength: 'd6', timeControl: '5+5', showForbidden: true, showEval: false }),
        ),
      )
      await p2.reload()
      await p2.locator('.clock.running', { hasText: '你' }).waitFor({ timeout: 5000 })
      const a = await p2.locator('.clock.running b').innerText()
      await p2.clock.runFor(3000)
      const b = await p2.locator('.clock.running b').innerText()
      if (a !== '5:00' || b !== '4:57') throw new Error(`棋鐘走秒不對：${a} → ${b}`)
      // 先下天元（零手的局不存檔），等 AI 交換決定完、輪回人方再快轉
      await p2.locator('rect[aria-label="(7,7)"]').click()
      await p2.locator('.status b', { hasText: /輪到你下第|你決定是否交換/ }).waitFor({ timeout: 120000 })
      await p2.clock.runFor(6 * 60_000)
      await p2.locator('.status b', { hasText: '超時' }).waitFor({ timeout: 5000 })
      await p2.goto(`${BASE}/#/records`)
      const first = await p2.locator('.record-item').first().innerText()
      if (!/塔拉山口-10/.test(first) || !/超時/.test(first)) throw new Error(`棋譜庫標示不對：${first}`)
    } finally {
      await p2.close()
    }
  })

  // ---- 16. 打點複習（漱星閣開局指南）----------------------------------------
  await step('打點複習：寒預標 7 個黑優點→全對；漏標→進錯題本', async () => {
    await page.goto(`${BASE}/#/`)
    await page.locator('nav a', { hasText: '打點' }).click()
    await page.locator('select[aria-label="開局"]').selectOption('d1')
    await page.locator('.guide-title', { hasText: '寒預' }).waitFor({ timeout: 10000 })
    const prompt = await page.locator('.guide-prompt').innerText()
    if (!/黑優點 7 個/.test(prompt) || !/平衡點 0 個/.test(prompt)) throw new Error(`寒預應為黑優 7、平衡 0：${prompt}`)
    // 寒預 PDF 原方位的黑優點：a1 I9、a2 I7、a3 J8、a4 I8、a5 J10、a6 I10、7 H7
    const pts = [[8, 6], [8, 8], [9, 7], [8, 7], [9, 5], [8, 5], [7, 8]]
    const g = (x, y) => page.locator(`.guide-board rect[aria-label="(${x},${y})"]`)
    for (const [x, y] of pts) await g(x, y).click()
    await page.locator('button', { hasText: '對答案' }).click()
    await page.locator('.guide-result', { hasText: '全對' }).waitFor({ timeout: 3000 })
    await page.locator('button', { hasText: '下一題' }).click()
    await page.locator('button', { hasText: '對答案' }).click() // 什麼都沒標 → 錯
    await page.locator('.guide-result', { hasText: '再加油' }).waitFor({ timeout: 3000 })
    await page.locator('select[aria-label="範圍"]').selectOption('wrong')
    await page.locator('.guide-title').waitFor({ timeout: 3000 })
    if (!/錯題本（1）/.test(await page.locator('select[aria-label="範圍"]').innerText())) throw new Error('錯題本計數不對')
  })

  await step('打點複習：殘險 黑優點一下＋平衡點兩下→全對；標反顏色→提示', async () => {
    const { targetsSplit } = await import('../src/guide/quiz.ts')
    const data = JSON.parse(readFileSync(join(ROOT, 'src/guide/guide-data.json'), 'utf8'))
    const v = data.find((x) => x.name === '殘險')
    const t = targetsSplit(v)
    if (t.equal.length === 0) throw new Error('殘險應有平衡點')
    await page.locator('select[aria-label="範圍"]').selectOption('all')
    await page.locator('select[aria-label="開局"]').selectOption(v.opening)
    for (let i = 0; i < 20; i++) {
      if ((await page.locator('.guide-title').innerText()).includes('殘險')) break
      await page.locator('button', { hasText: '下一題' }).click()
    }
    const g = (l) => page.locator(`.guide-board rect[aria-label="(${l[0]},${l[1]})"]`)
    for (const l of t.black) await g(l).click()
    for (const l of t.equal) await g(l).click({ clickCount: 1 }).then(() => g(l).click())
    await page.locator('button', { hasText: '對答案' }).click()
    await page.locator('.guide-result', { hasText: '全對' }).waitFor({ timeout: 3000 })
    await page.locator('button', { hasText: '重來' }).click()
    for (const l of t.black) await g(l).click()
    for (const l of t.equal) await g(l).click() // 只點一下＝標成黑優（顏色反了）
    await page.locator('button', { hasText: '對答案' }).click()
    await page.locator('.guide-result', { hasText: '顏色標反' }).waitFor({ timeout: 3000 })
  })

  await step('打點複習：切到《玄》→寒預黑優＋平衡全對→連到玄庫同一局面', async () => {
    const { targetsSplit } = await import('../src/guide/quiz.ts')
    const data = JSON.parse(readFileSync(join(ROOT, 'scratch/xuan/xuan-data.json'), 'utf8'))
    const v = data.find((x) => x.name === '寒預')
    const t = targetsSplit(v)
    await page.locator('select[aria-label="資料來源"]').selectOption('xuan')
    // 加密：先試錯密碼，再用本機 scratch/xuan/.password 解鎖
    await page.locator('input[aria-label="玄庫密碼"]').fill('wrong-password')
    await page.locator('button', { hasText: '解鎖' }).click()
    await page.locator('.msg.err', { hasText: '密碼不對' }).waitFor({ timeout: 20000 })
    await page.locator('input[aria-label="玄庫密碼"]').fill(readFileSync(join(ROOT, 'scratch/xuan/.password'), 'utf8').trim())
    await page.locator('button', { hasText: '解鎖' }).click()
    await page.locator('select[aria-label="開局"]').selectOption('d1')
    for (let i = 0; i < 40; i++) {
      if ((await page.locator('.guide-title').innerText()).includes('寒預')) break
      await page.locator('button', { hasText: '下一題' }).click()
    }
    const prompt = await page.locator('.guide-prompt').innerText()
    if (!prompt.includes(`黑優點 ${t.black.length} 個`) || !prompt.includes(`平衡點 ${t.equal.length} 個`)) throw new Error(`玄寒預題目不對：${prompt}`)
    const g = (l) => page.locator(`.guide-board rect[aria-label="(${l[0]},${l[1]})"]`)
    for (const l of t.black) await g(l).click()
    for (const l of t.equal) await g(l).click().then(() => g(l).click())
    await page.locator('button', { hasText: '對答案' }).click()
    await page.locator('.guide-result', { hasText: '全對' }).waitFor({ timeout: 3000 })
    await page.locator('.guide-result', { hasText: 'A（黑必勝）× 6' }).waitFor({ timeout: 3000 })
    await page.locator('a', { hasText: '在玄庫看後續變化' }).click()
    await page.locator('.status', { hasText: '第 4 手' }).waitFor({ timeout: 20000 })
    if ((await page.locator('svg[aria-label="玄庫棋盤"] [data-mark="A1"]').count()) !== 1) throw new Error('玄庫寒預局面應有 A1 標記')
    await page.locator('select[aria-label="資料來源"]').count() // 不在打點頁了
    await page.goto(`${BASE}/#/guide`)
    await page.locator('select[aria-label="資料來源"]').selectOption('')
  })

  await step('玄庫看譜：記住密碼免輸入→跳開局→點評等走下去→右鍵退→庫外自擺→在擺譜開啟→鎖上', async () => {
    await page.goto(`${BASE}/#/`)
    await page.locator('nav a', { hasText: '玄庫' }).click()
    await page.locator('select[aria-label="跳到開局"]').waitFor({ timeout: 20000 })
    await page.locator('select[aria-label="跳到開局"]').selectOption('d4') // 花月
    await page.locator('.status', { hasText: '花月・第 3 手' }).waitFor({ timeout: 3000 })
    const nexts = await page.locator('.lib-next').count()
    if (nexts < 5) throw new Error(`花月庫內白 4 應不少：${nexts}`)
    const firstChip = await page.locator('.lib-next').first().innerText()
    await page.locator('.lib-next').first().click()
    await page.locator('.status', { hasText: '第 4 手' }).waitFor({ timeout: 3000 })
    if (!/#\/lib\/[a-o]{8}$/.test(page.url())) throw new Error(`網址應記 4 手：${page.url()}`)
    await page.locator('svg[aria-label="玄庫棋盤"]').click({ button: 'right', position: { x: 10, y: 10 } })
    await page.locator('.status', { hasText: '第 3 手' }).waitFor({ timeout: 3000 })
    // 角落 A15 必不在庫內 → 庫外自擺
    await page.locator('svg[aria-label="玄庫棋盤"] rect[aria-label="(0,0)"]').click()
    await page.locator('.status', { hasText: '庫外第 1 手' }).waitFor({ timeout: 3000 })
    await page.locator('button', { hasText: '回庫內' }).click()
    await page.locator('.status', { hasText: '第 3 手' }).waitFor({ timeout: 3000 })
    await page.locator('a', { hasText: '在擺譜開啟這個局面' }).click()
    await page.waitForURL(/#\/study\/r1:[a-o]{6}$/, { timeout: 5000 })
    if (!firstChip) throw new Error('變化按鈕沒文字')
    // Rapfi 建議路線：照建議下一手後，下一手建議還在（同擺譜頁的跟著走）
    await page.goto(`${BASE}/#/lib/hhhgig`)
    await page.locator('select[aria-label="Rapfi 思考時間"]').selectOption('1000')
    await page.locator('button', { hasText: 'Rapfi 分析' }).click()
    await page.locator('.rapfi-result').waitFor({ timeout: 60000 })
    for (let i = 0; i < 2; i++) {
      const pos = await page.locator('svg[aria-label="玄庫棋盤"] [data-pv="1"]').getAttribute('data-pos', { timeout: 3000 })
      const [px, py] = pos.split(',').map(Number)
      await page.locator(`svg[aria-label="玄庫棋盤"] rect[aria-label="(${px},${py})"]`).click()
      await page.locator('.status', { hasText: `第 ${4 + i} 手` }).waitFor({ timeout: 3000 })
    }
    if ((await page.locator('svg[aria-label="玄庫棋盤"] [data-pv]').count()) === 0) throw new Error('玄庫照路線走兩手後建議路線消失')
    // 鎖上 → 回到密碼框（本機金鑰清掉，重新整理也要再輸入）
    await page.goto(`${BASE}/#/lib`)
    await page.locator('button', { hasText: '鎖上' }).click()
    await page.locator('input[aria-label="玄庫密碼"]').waitFor({ timeout: 3000 })
    await page.reload()
    await page.locator('input[aria-label="玄庫密碼"]').waitFor({ timeout: 10000 })
  })

  // ---- 15. 對弈頁難度 5＝Rapfi ----------------------------------------------
  await step('對弈：難度 5（Rapfi）落子→Rapfi 回手', async () => {
    await page.goto(`${BASE}/#/play`)
    await page.locator('select[aria-label="對局模式"]').selectOption('free')
    await page.locator('select[aria-label="AI 難度"]').selectOption('5')
    await page.locator('button', { hasText: '重開' }).click()
    await cell(7, 7).click()
    await waitStones(2, 60000)
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
