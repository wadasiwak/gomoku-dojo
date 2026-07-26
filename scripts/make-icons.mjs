// 一次性工具：用 headless Chromium 把 favicon.svg 轉成 PWA 用的 PNG icon。
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const svg = readFileSync(join(root, 'public/favicon.svg'), 'utf8')

const browser = await chromium.launch()
for (const size of [192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } })
  await page.setContent(
    `<body style="margin:0"><div style="width:${size}px;height:${size}px">${svg.replace(
      '<svg ',
      `<svg width="${size}" height="${size}" `,
    )}</div></body>`,
  )
  await page.screenshot({ path: join(root, `public/icon-${size}.png`), omitBackground: true })
  await page.close()
}
await browser.close()
console.log('icons done')
