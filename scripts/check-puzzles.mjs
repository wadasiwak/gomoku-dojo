// 題庫全量重驗：每題重播棋譜 → 手番/終局檢查 → solveVcf 由淺至深重求
// 最小深度（與 generator 同一套 puzzle-verify.mjs 邏輯）→ 比對標註。
// 另驗 id 唯一/格式、難度分佈統計。任何一題不過 → exit 1。
//
//   node scripts/check-puzzles.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { verifyPuzzle, DIFF_LABEL } from './puzzle-verify.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const FILE = join(ROOT, 'src', 'puzzles', 'puzzles.json')

const doc = JSON.parse(readFileSync(FILE, 'utf8'))
const puzzles = doc.puzzles
const t0 = Date.now()
let failures = 0

// 結構檢查
const ids = new Set()
for (const p of puzzles) {
  const errs = []
  if (!/^p\d{3}$/.test(p.id)) errs.push(`id 格式不對：${p.id}`)
  if (ids.has(p.id)) errs.push(`id 重複：${p.id}`)
  ids.add(p.id)
  if (!['renju', 'gomoku'].includes(p.rule)) errs.push(`rule 不合法：${p.rule}`)
  if (!['black', 'white'].includes(p.attacker)) errs.push(`attacker 不合法：${p.attacker}`)
  if (!Array.isArray(p.solution) || p.solution.length === 0) errs.push('solution 缺失')
  if (!p.verify?.minDepthProven) errs.push('verify.minDepthProven 不為 true')
  if (errs.length) {
    failures++
    console.error(`✗ ${p.id}：${errs.join('；')}`)
  }
}

// 引擎重驗（每題獨立求解，慢但全面）
for (const p of puzzles) {
  const { ok, errors } = verifyPuzzle(p)
  if (!ok) {
    failures++
    console.error(`✗ ${p.id}（${p.rule} ${p.attacker} 深度${p.vcfDepth}）：${errors.join('；')}`)
  }
}

const byDiff = {}
const byDepth = {}
const byRule = {}
for (const p of puzzles) {
  byDiff[p.difficulty] = (byDiff[p.difficulty] ?? 0) + 1
  byDepth[p.vcfDepth] = (byDepth[p.vcfDepth] ?? 0) + 1
  byRule[p.rule] = (byRule[p.rule] ?? 0) + 1
}

console.log('=== 題庫檢查 ===')
console.log(`總題數：${puzzles.length}`)
console.log(
  '難度分佈：',
  Object.entries(byDiff)
    .map(([k, v]) => `${DIFF_LABEL[k]} ${v}`)
    .join('、'),
)
console.log('深度分佈：', JSON.stringify(byDepth))
console.log('規則分佈：', JSON.stringify(byRule))
console.log(`重驗耗時：${((Date.now() - t0) / 1000).toFixed(1)}s`)

if (failures > 0) {
  console.error(`\n✗ ${failures} 題未通過重驗`)
  process.exit(1)
}
console.log('✓ 全數通過（solveVcf 重驗＋最小深度證明＋主變化收尾檢查）')
