// 26 開局珠型資料完備性驗證（npm run check 的一部分）。
//
// EXPECTED 對照表是 renju.net 官方打點圖（/upload/staticfiles/direct_openings.png、
// indirect_openings.png，與 Wikipedia「Renju opening pattern」同組圖）的**獨立轉錄**
// ——與 src/content/openings.ts 的 record 各自轉錄互相印證，任何一份抄錯都會在
// 這裡撞出來。座標用 RIF 記法（a–o 含 i、列 15..1，h8＝天元）。
//
//   node scripts/check-openings.mjs
import { OPENINGS, findOpeningByMoves, TENDENCY_LEVEL } from '../src/content/openings.ts'
import { canonicalMovesKey } from '../src/engine/symmetry.ts'
import { parseRecord } from '../src/engine/record.ts'

// RIF 記法 → 內部座標（x = 字母序，y = 15 - 列號）。
function coord(s) {
  const x = s.charCodeAt(0) - 'a'.charCodeAt(0)
  const y = 15 - Number(s.slice(1))
  return { x, y }
}

const EXPECTED = {
  // 直接開局（白2 = h9）：renju.net direct_openings.png 打點 1..13
  d1: ['h8', 'h9', 'h10'],
  d2: ['h8', 'h9', 'i10'],
  d3: ['h8', 'h9', 'j10'],
  d4: ['h8', 'h9', 'i9'],
  d5: ['h8', 'h9', 'j9'],
  d6: ['h8', 'h9', 'i8'],
  d7: ['h8', 'h9', 'j8'],
  d8: ['h8', 'h9', 'h7'],
  d9: ['h8', 'h9', 'i7'],
  d10: ['h8', 'h9', 'j7'],
  d11: ['h8', 'h9', 'h6'],
  d12: ['h8', 'h9', 'i6'],
  d13: ['h8', 'h9', 'j6'],
  // 間接開局（白2 = i9）：indirect_openings.png 打點 1..13
  i1: ['h8', 'i9', 'j10'],
  i2: ['h8', 'i9', 'j9'],
  i3: ['h8', 'i9', 'j8'],
  i4: ['h8', 'i9', 'j7'],
  i5: ['h8', 'i9', 'j6'],
  i6: ['h8', 'i9', 'i8'],
  i7: ['h8', 'i9', 'i7'],
  i8: ['h8', 'i9', 'i6'],
  i9: ['h8', 'i9', 'h7'],
  i10: ['h8', 'i9', 'h6'],
  i11: ['h8', 'i9', 'g7'],
  i12: ['h8', 'i9', 'g6'],
  i13: ['h8', 'i9', 'f6'],
}

// 名稱對照（renju.net 官方羅馬字 ↔ 中文名，587.renju.org.tw 覆核）。
const NAMES = {
  d1: '寒星', d2: '溪月', d3: '疏星', d4: '花月', d5: '殘月', d6: '雨月', d7: '金星',
  d8: '松月', d9: '丘月', d10: '新月', d11: '瑞星', d12: '山月', d13: '遊星',
  i1: '長星', i2: '峽月', i3: '恆星', i4: '水月', i5: '流星', i6: '雲月', i7: '浦月',
  i8: '嵐月', i9: '銀月', i10: '明星', i11: '斜月', i12: '名月', i13: '彗星',
}

let failures = 0
const fail = (msg) => {
  failures++
  console.error(`✗ ${msg}`)
}

const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))
const CENTER = { x: 7, y: 7 }

// ---- 結構與座標 -------------------------------------------------------------
if (OPENINGS.length !== 26) fail(`開局數不是 26：${OPENINGS.length}`)
const ids = new Set()
const names = new Set()
const records = new Set()
const canon = new Set()
const byKind = { direct: new Set(), indirect: new Set() }

for (const o of OPENINGS) {
  if (!/^[di](1[0-3]|[1-9])$/.test(o.id)) fail(`${o.id}: id 格式不對`)
  if (ids.has(o.id)) fail(`${o.id}: id 重複`)
  ids.add(o.id)
  if (names.has(o.name)) fail(`${o.id}: 名稱重複 ${o.name}`)
  names.add(o.name)
  if (records.has(o.record)) fail(`${o.id}: record 重複`)
  records.add(o.record)
  if (NAMES[o.id] !== o.name) fail(`${o.id}: 名稱 ${o.name} ≠ 對照表 ${NAMES[o.id]}`)
  if ((o.kind === 'direct') !== o.id.startsWith('d')) fail(`${o.id}: kind 與 id 不一致`)
  if (o.index !== Number(o.id.slice(1))) fail(`${o.id}: index ${o.index} 與 id 不一致`)
  byKind[o.kind].add(o.index)

  const rec = parseRecord(o.record)
  if (!rec || rec.rule !== 'renju' || rec.moves.length !== 3) {
    fail(`${o.id}: record 非法或不是 3 手連珠譜：${o.record}`)
    continue
  }
  const [m1, m2, m3] = rec.moves
  const exp = EXPECTED[o.id].map(coord)
  for (let i = 0; i < 3; i++) {
    if (rec.moves[i].x !== exp[i].x || rec.moves[i].y !== exp[i].y)
      fail(
        `${o.id} ${o.name}: 第 ${i + 1} 手 (${rec.moves[i].x},${rec.moves[i].y}) ≠ 官方圖 ${EXPECTED[o.id][i]} (${exp[i].x},${exp[i].y})`,
      )
  }
  if (m1.x !== CENTER.x || m1.y !== CENTER.y) fail(`${o.id}: 第 1 手不是天元`)
  const d2c = cheb(m2, CENTER)
  if (d2c !== 1) fail(`${o.id}: 第 2 手不在中央 3×3`)
  const orth = Math.abs(m2.x - CENTER.x) + Math.abs(m2.y - CENTER.y) === 1
  if (o.kind === 'direct' && !orth) fail(`${o.id}: 直接開局但白2 非直鄰`)
  if (o.kind === 'indirect' && orth) fail(`${o.id}: 間接開局但白2 非斜鄰`)
  if (cheb(m3, CENTER) > 2) fail(`${o.id}: 第 3 手不在中央 5×5`)

  const key = canonicalMovesKey(rec.moves)
  if (canon.has(key)) fail(`${o.id}: 對稱歸一 key 與其他開局重複（非獨立珠型）`)
  canon.add(key)

  const len = [...o.intro].length
  if (len < 60 || len > 120) fail(`${o.id} ${o.name}: intro ${len} 字（需 60–120）`)
  if (TENDENCY_LEVEL[o.tendency] === undefined) fail(`${o.id}: tendency 非法 ${o.tendency}`)
  else if (Math.sign(TENDENCY_LEVEL[o.tendency]) !== Math.sign(o.level) ||
    Math.abs(TENDENCY_LEVEL[o.tendency]) !== Math.abs(o.level))
    fail(`${o.id}: level ${o.level} 與 tendency ${o.tendency} 不一致`)
}
for (const kind of ['direct', 'indirect']) {
  if (byKind[kind].size !== 13) fail(`${kind} 開局不是 13 種：${byKind[kind].size}`)
}

// ---- 完備性：所有合法前三手（白2∈3×3、黑3∈5×5）都要對得到 26 型之一 -----------
let combos = 0
for (let dx2 = -1; dx2 <= 1; dx2++)
  for (let dy2 = -1; dy2 <= 1; dy2++) {
    if (dx2 === 0 && dy2 === 0) continue
    const m2 = { x: 7 + dx2, y: 7 + dy2 }
    for (let dx3 = -2; dx3 <= 2; dx3++)
      for (let dy3 = -2; dy3 <= 2; dy3++) {
        const m3 = { x: 7 + dx3, y: 7 + dy3 }
        if ((m3.x === 7 && m3.y === 7) || (m3.x === m2.x && m3.y === m2.y)) continue
        combos++
        if (!findOpeningByMoves([CENTER, m2, m3]))
          fail(`完備性：白2(${m2.x},${m2.y}) 黑3(${m3.x},${m3.y}) 對不到任何珠型`)
      }
  }

console.log('=== 開局資料檢查 ===')
console.log(`珠型數：${OPENINGS.length}（直接 ${byKind.direct.size}／間接 ${byKind.indirect.size}）`)
console.log(`合法前三手組合 ${combos} 種全數可歸一到 26 型`)

if (failures > 0) {
  console.error(`\n✗ ${failures} 項未通過`)
  process.exit(1)
}
console.log('✓ 全數通過（官方圖座標對照＋名稱對照＋對稱歸一互斥＋完備性＋文案字數）')
