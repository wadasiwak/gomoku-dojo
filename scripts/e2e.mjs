// e2e（playwright + vite preview:5311，finally kill）：
//   1. 首頁四入口
//   2. 對弈完整流程：落子 → AI 回手 → 悔棋 → 認輸 → 戰績入庫＋棋譜自動存檔
//   3. renju 禁手點標記出現（__dojo.loadPlay 測試 hook 鋪雙活三前置）
//   4. 題庫：答錯 → 錯題本；答對（引擎判定）→ 通關；重練 → 連對 1
//   5. 棋譜分享 URL 還原一致（round-trip）＋非法棋譜嚴格拒絕
//   6. 自由研棋：重播中停在任一手岔出變化＋AI 建議＋回到棋譜
//   7. 擺譜研究：擺子/清除 → 試下 → AI 建議
//   8. 開局圖鑑：26 卡片牆 → 詳情 → 用此開局對弈；猜名練習答對計分
//   9. RIF 正式規約：AI 擺開局→換邊決定→白4→兩打→擇打→正常輪替；
//      r2 棋譜 round-trip／竄改拒絕／悔棋規約下限
//  10. GoatCounter path 只回報 pathname（無 hash/query）
//  11. 匯入棋譜：座標序列（容錯分隔）→重播；非法行內指出第幾手；擺譜頁載入
//  12. 資源頁：三站外連＋關係聲明＋footer Rapfi 致謝
//  13. Rapfi 分析：載入引擎（40MB 本機快取，timeout 放寬 120s）→建議 hint＋結果
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
  page = await browser.newPage({ viewport: { width: 1280, height: 960 } })

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
  await step('擺譜研究：擺子/清除→試下→AI 建議', async () => {
    await page.goto(`${BASE}/#/study`)
    await page.locator('.goban').waitFor()
    // 預設「輪流」：自動一黑一白；再點一次拿掉後子數重算
    await cell(7, 7).click() // 輪流 → 黑
    await cell(6, 6).click() // 輪流 → 白
    if ((await page.locator('.stone.white').count()) !== 1)
      throw new Error('輪流模式第二顆應為白子')
    await cell(6, 6).click() // 再點拿掉
    await waitStones(1)
    await cell(6, 6).click() // 拿掉後重算 → 仍是白
    if ((await page.locator('.stone.white').count()) !== 1)
      throw new Error('輪流模式拿掉重擺應為白子')
    await cell(6, 6).click() // 清掉，回到單黑，接原有單色工具流程
    await waitStones(1)
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
    await page.locator('.pt-mark').first().waitFor({ timeout: 25000 }) // AI 兩打 A/B
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
    // AI（白）擇打成立第 5 手後緊接搜索第 6 手，兩步可能連跳 → 等至少 6
    await waitStonesAtLeast(6)
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
    await page.locator('.status', { hasText: '黑 2 子、白 1 子' }).waitFor({ timeout: 5000 })
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
  await step('Rapfi 分析：載入引擎→建議 hint＋評分/PV（首載 40MB 走本機）', async () => {
    await page.goto(`${BASE}/#/replay/r1:hhhgii`)
    await waitStones(3)
    await page.locator('select[aria-label="Rapfi 思考時間"]').selectOption('1000')
    await page.locator('button', { hasText: 'Rapfi 分析' }).click()
    await page.locator('.rapfi-result').waitFor({ timeout: 120000 })
    await page.locator('.hint-mark').waitFor({ timeout: 5000 })
    const txt = await page.locator('.rapfi-result').innerText()
    if (!/Rapfi 建議：/.test(txt)) throw new Error(`結果缺建議手：${txt}`)
    await page.screenshot({ path: `${OUT}/rapfi-analysis.png` })
  })

  await step('Rapfi 分析：擺譜試下也拿得到建議（board 形式輸入）', async () => {
    await page.goto(`${BASE}/#/study/r1:hhhgii`)
    await page.locator('button', { hasText: '開始試下' }).click()
    await page.locator('.status', { hasText: '試下中' }).waitFor({ timeout: 5000 })
    await page.locator('select[aria-label="Rapfi 思考時間"]').selectOption('1000')
    await page.locator('button', { hasText: 'Rapfi 分析' }).click()
    // 引擎已載入（上一步），這裡只等思考
    await page.locator('.rapfi-result').waitFor({ timeout: 60000 })
    await page.locator('.hint-mark').waitFor({ timeout: 5000 })
    await page.screenshot({ path: `${OUT}/rapfi-study.png` })
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
