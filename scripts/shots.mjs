// 截圖輔助：桌面＋行動版各截 首頁/對弈/題庫答題/科普 供人工親眼檢查
// （棋盤格點對齊、星位、行動版可點性）。先起 preview：
//   npx vite preview --port 5312 &&（另一終端）node scripts/shots.mjs
import { chromium } from 'playwright'
import { mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const BASE = process.env.BASE ?? 'http://localhost:5312'
const OUT = process.env.OUT ?? '/tmp/gomoku-shots'
mkdirSync(OUT, { recursive: true })

const puzzles = JSON.parse(readFileSync(join(ROOT, 'src/puzzles/puzzles.json'), 'utf8')).puzzles
const firstEasy = puzzles.find((p) => p.difficulty === 'easy')?.id
const firstHard = (puzzles.find((p) => p.difficulty === 'hard') ?? puzzles.at(-1))?.id

const browser = await chromium.launch()

for (const [tag, viewport] of [
  ['desktop', { width: 1280, height: 960 }],
  ['mobile', { width: 390, height: 844 }],
]) {
  const page = await browser.newPage({ viewport })
  const shot = (name) => page.screenshot({ path: `${OUT}/${tag}-${name}.png`, fullPage: false })

  await page.goto(`${BASE}/#/`)
  await page.waitForSelector('.entry-card')
  await shot('home')

  // 對弈：鋪一個雙活三前置局面看禁手標記＋盤面
  await page.goto(`${BASE}/#/play`)
  await page.waitForFunction(() => !!window.__dojo)
  await page.evaluate(() => window.__dojo.loadPlay('r1:fhaaghbahfcahgda'))
  await page.waitForSelector('.fb-mark', { timeout: 15000 })
  await shot('play')

  // 題庫列表＋答題
  await page.goto(`${BASE}/#/puzzles`)
  await page.waitForSelector('.puzzle-card')
  await shot('puzzles')
  await page.goto(`${BASE}/#/puzzle/${firstEasy}`)
  await page.waitForSelector('.goban')
  await shot('puzzle-easy')
  await page.goto(`${BASE}/#/puzzle/${firstHard}`)
  await page.waitForSelector('.goban')
  await shot('puzzle-hard')

  // 科普
  await page.goto(`${BASE}/#/rules`)
  await page.waitForSelector('.rule-card')
  await shot('rules')

  // 開局圖鑑：卡片牆＋詳情＋猜名
  await page.goto(`${BASE}/#/openings`)
  await page.waitForSelector('.opening-card')
  await shot('openings')
  await page.goto(`${BASE}/#/openings/i7`)
  await page.waitForSelector('.opening-detail')
  await shot('opening-detail')
  await page.goto(`${BASE}/#/openings/guess`)
  await page.waitForSelector('.guess-opt')
  await shot('opening-guess')

  // 規約兩打選點 UI（白方擇打視角：A/B 標記）：載入 4 手＋兩打的中途規約譜
  await page.goto(`${BASE}/#/play`)
  await page.waitForFunction(() => !!window.__dojo)
  await page.evaluate(() =>
    window.__dojo.loadPlay('r2:hhigiijg:oi7s0tgijj', { player: 'white' }),
  )
  await page.waitForSelector('.pt-mark', { timeout: 15000 })
  await shot('play-rif-choose')

  await page.close()
}

await browser.close()
console.log('shots →', OUT)
