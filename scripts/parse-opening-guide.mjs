// 解析《漱星閣開局指南》（中國漱星閣群組整理，2026.4.3 版）PDF → 每個白 4 變化的結構化資料。
//   pdftotext -bbox 漱星阁开局指南2026.4.3.pdf guide.html   # brew install poppler
//   node scripts/parse-opening-guide.mjs guide.html > scratch/white4/guide.json
//
// 指南版面（實測）：每頁一個「開局×白 4」變化，15×15 全盤圖，格距 20pt，第 1 手在天元。
// 盤上文字：棋子 1–4（字高 23pt）；第 5 手標籤（字高 21.3pt），數字＝打點強弱名次：
//   aN（綠）＝黑必勝　純數字 N（黑）＝平衡／白稍優　cN?（橘）＝白近勝　cN（紅）＝黑敗
// 「N 打黑勝」的 N＝綠色 a 點數＝黑必勝第 5 手數（塔拉山口-10：< 10 → 對方打不出十打）。
// 指南的棋盤方位不一定與本站 openings.ts 相同 → 用 8 對稱找出把指南前三手映到本站
// 前三手的變換，白 4 與標籤一併轉過去。
import { readFileSync } from 'node:fs'
import { OPENINGS, openingMoves } from '../src/content/openings.ts'
import { SYMMETRIES } from '../src/engine/symmetry.ts'

const src = readFileSync(process.argv[2], 'utf8')
const pages = src.split('<page ').slice(1)

/** 指南用簡體名 → 本站開局 id。 */
const SIMP = { 残: '殘', 游: '遊', 长: '長', 峡: '峽', 恒: '恆', 云: '雲', 岚: '嵐', 银: '銀', 鬆: '松' }
const toTrad = (s) => [...s].map((c) => SIMP[c] ?? c).join('')
const byName = new Map(OPENINGS.map((o) => [o.name, o]))

const GRID = 20
const out = []
const problems = []
pages.forEach((p, pi) => {
  const words = [...p.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)].map(
    (m) => {
      const [x0, y0, x1, y1] = [+m[1], +m[2], +m[3], +m[4]]
      return { t: m[5].replace(/&apos;/g, "'"), cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, h: y1 - y0, x0, x1, y0 }
    },
  )
    // 少數標籤在 PDF 裡黏成一個字（如「15c19?」）：依字元比例拆回各自位置
    .flatMap((w) => {
      const toks = [...w.t.matchAll(/[ac]?\d+'?\??/g)].map((m) => ({ s: m[0], i: m.index }))
      if (w.h > 22 || toks.length < 2 || toks.map((t) => t.s).join('') !== w.t) return [w]
      const per = (w.x1 - w.x0) / w.t.length
      return toks.map((t) => ({ ...w, t: t.s, cx: w.x0 + per * (t.i + t.s.length / 2) }))
    })
  const board = words.filter((w) => w.cx > 55 && w.cx < 355 && w.cy > 55 && w.cy < 355)
  const stones = board.filter((w) => /^[1-4]$/.test(w.t) && w.h > 22)
  if (stones.length !== 4) return // 封面、目錄等非變化頁
  const title = words.find((w) => w.cy < 55 && w.cx > 200 && w.cx < 400)
  const variation = words.find((w) => w.cx > 380 && w.cy > 60 && w.cy < 100)
  const s1 = stones.find((w) => w.t === '1')
  const ox = s1.cx - 7 * GRID
  const oy = s1.cy - 7 * GRID
  const at = (w) => ({ x: Math.round((w.cx - ox) / GRID), y: Math.round((w.cy - oy) / GRID) })
  const gstones = ['1', '2', '3', '4'].map((n) => at(stones.find((w) => w.t === n)))
  const labels = []
  for (const w of board) {
    if (w.h > 22) continue
    // 標籤：[a|c]?名次['＝對稱盤面的鏡像那一套][?＝不確定]
    const m = /^([ac])?(\d+)(')?(\?)?$/.exec(w.t)
    let kind = null
    if (m) {
      const q = !!m[4]
      kind = m[1] === 'a' ? (q ? 'winq' : 'win') : m[1] === 'c' ? (q ? 'near' : 'lose') : 'bal'
    }
    const rank = m ? +m[2] : null
    const prime = m ? !!m[3] : false
    if (!kind) {
      problems.push(`p${pi + 1} 無法辨識標籤「${w.t}」`)
      continue
    }
    labels.push({ kind, rank, prime, pos: at(w) })
  }
  const name = title ? toTrad(title.t) : '?'
  const o = byName.get(name)
  if (!o) {
    problems.push(`p${pi + 1} 開局名「${name}」對不到本站開局`)
    return
  }
  // 找對稱變換：指南前三手 → 本站前三手
  const ours = openingMoves(o)
  const T = SYMMETRIES.find((t) => gstones.slice(0, 3).every((g, i) => {
    const q = t(g.x, g.y)
    return q.x === ours[i].x && q.y === ours[i].y
  }))
  if (!T) {
    problems.push(`p${pi + 1} ${name}/${variation?.t}：前三手方位對不上本站開局`)
    return
  }
  const tf = (p) => T(p.x, p.y)
  // 黑必勝點數＝必勝標籤的「不同名次」數（a3 與鏡像 a3' 對稱等價，十打只能擇一）；
  // aN?（不確定的必勝）保守計入——寧可把白 4 判成不安全。
  // 右欄註記（「N 打黑勝」「生死局？」等）；「生死局」或有 aN?（指南自己也不確定的必勝點）
  // ＝國手說的「感覺也很難」的變化，額外加算
  const notes = words
    .filter((w) => w.cx > 352 && w.cy > 100 && w.cy < 355)
    .sort((a, b) => a.cy - b.cy || a.cx - b.cx)
    .map((w) => w.t)
    .join('')
  const hard = /生死/.test(notes) || labels.some((l) => l.kind === 'winq')
  const winCount = new Set(labels.filter((l) => l.kind === 'win' || l.kind === 'winq').map((l) => l.rank)).size
  out.push({
    page: pi + 1,
    opening: o.id,
    openingName: o.name,
    variation: variation ? toTrad(variation.t) : '?',
    w4: tf(gstones[3]),
    winCount,
    viable: winCount < 10,
    hard,
    notes,
    // PDF 原始方位（打點複習頁照指南圖面顯示，跟國手讀 PDF 時的記憶一致）
    raw: { stones: gstones, labels: [...labels].sort((a, b) => a.rank - b.rank) },
    labels: labels.map((l) => ({ ...l, pos: tf(l.pos) })).sort((a, b) => a.rank - b.rank),
  })
})
console.error(`變化 ${out.length} 頁；可用（黑必勝點 < 10）${out.filter((v) => v.viable).length}；問題 ${problems.length}`)
for (const p of problems.slice(0, 30)) console.error('  ' + p)
console.log(JSON.stringify(out))
