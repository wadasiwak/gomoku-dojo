// 手動驗證輔助：起好 preview（port 5312）後，戳出雙活三局面 → 截禁手標記 →
// 踩禁手判負 → 悔棋 → AI 走一手 → VCF 查詢，逐步截圖到 /tmp。
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://localhost:5312'
const OUT = process.env.OUT ?? '/tmp/gomoku-shots'
import { mkdirSync } from 'node:fs'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 760, height: 980 } })
await page.goto(BASE)
await page.waitForSelector('.board')

const click = async (x, y) => {
  await page.click(`button[aria-label="(${x},${y})"]`)
  await page.waitForTimeout(120)
}

// 黑做出橫直雙活三的前置（黑 (5,7)(6,7)(7,5)(7,6)），白手下在邊角
await click(5, 7)
await click(0, 0)
await click(6, 7)
await click(1, 0)
await click(7, 5)
await click(2, 0)
await click(7, 6)
await click(3, 0)
// 等 worker 禁手掃描標記出現
await page.waitForSelector('.fb', { timeout: 10000 })
await page.screenshot({ path: `${OUT}/1-forbidden-mark.png` })

// 黑硬踩 (7,7) 三三 → 應判負（白勝）
await click(7, 7)
await page.waitForTimeout(200)
await page.screenshot({ path: `${OUT}/2-forbidden-loss.png` })

// 悔棋拉回 → AI 走一手（白）
await page.click('text=悔棋')
await page.waitForSelector('.fb', { timeout: 10000 })
await page.click('text=AI 走一手')
await page.waitForSelector('.ai-info', { timeout: 20000 })
await page.waitForTimeout(300)
await page.screenshot({ path: `${OUT}/3-ai-move.png` })

// VCF 查詢
await page.click('text=VCF 查詢')
await page.waitForFunction(
  () => document.querySelector('.ai-info')?.textContent?.includes('VCF'),
  { timeout: 20000 },
)
await page.screenshot({ path: `${OUT}/4-vcf-query.png` })

console.log('shots done →', OUT)
await browser.close()
