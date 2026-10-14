// 「防十打白 4＋陷阱黑 5」調查報告（讀 scratch/white4/phaseB2.jsonl → 單檔 HTML）：
//   node scripts/tara-white4-report.mjs [--out ~/tara-white4-2026-10.html]
// 資料由 scripts/tara-white4-survey.mjs 產生；定義見該檔檔頭。
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { OPENINGS, openingMoves, OPENING_KIND_LABEL } from '../src/content/openings.ts'
import { serializeRecord } from '../src/engine/record.ts'
import { canonicalBoardKey } from '../src/engine/symmetry.ts'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIR = path.join(ROOT, 'scratch', 'white4')
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`)
  return i > 0 ? process.argv[i + 1] : d
}
const OUT = arg('out', path.join(homedir(), 'tara-white4-2026-10.html'))
const SITE = 'https://wadasiwak.github.io/gomoku-dojo/#/study/'

const readJsonl = (f) =>
  existsSync(f)
    ? readFileSync(f, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : []
const A = readJsonl(path.join(DIR, 'phaseA.jsonl'))
// 平行行程各寫 phaseB2<tag>.jsonl → 全部合併（同一白 4 只取第一筆）
const B2 = (() => {
  const seen = new Set()
  return readdirSync(DIR)
    .filter((f) => /^phaseB2.*\.jsonl$/.test(f))
    .flatMap((f) => readJsonl(path.join(DIR, f)))
    .filter((r) => {
      const k = `${r.opening}|${r.w4.x},${r.w4.y}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
})()
/** 推薦精選的 10 秒複驗（scripts/tara-white4-verify.mjs）。key＝"開局|白4x,y|黑5x,y"。 */
const VERIFY = existsSync(path.join(DIR, 'verify.json')) ? JSON.parse(readFileSync(path.join(DIR, 'verify.json'), 'utf8')) : {}
/** 讓多執行緒引擎卡死／崩潰而略過的白 4（id＝"開局|x,y"）。 */
const SKIPPED = readJsonl(path.join(DIR, 'skipped.jsonl')).map((r) => r.id)
/** 《漱星閣開局指南》解析結果（scripts/parse-opening-guide.mjs）；沒有就略過指南欄位。 */
const GUIDE_FILE = path.join(DIR, 'guide.json')
const GUIDE = existsSync(GUIDE_FILE) ? JSON.parse(readFileSync(GUIDE_FILE, 'utf8')) : []
const sameP = (a, b) => a.x === b.x && a.y === b.y

// ---- RenjuNet 棋譜庫（https://www.renju.net/game/ 下載的 XML，放 scratch/renjunet/ 不進 git）----
// ⚠️ 授權：僅限非商業「離線」使用，禁止放到任何網站／線上系統 → 只進這份個人離線報告，
// 不進道場網站。統計：前 4 手／前 5 手的盤面（8 對稱歸一，與手順無關）在正式比賽出現次數
// 與黑方得分率（勝 1、和 0.5、負 0）；塔拉山口-10 系（rule 25/26/29）另計。
const RN_FILE = path.join(ROOT, 'scratch', 'renjunet', 'renju.xml')
const T10_RULES = new Set(['25', '26', '29'])
const keyOf = (moves) => {
  const b = new Uint8Array(225)
  moves.forEach((m, i) => (b[m.y * 15 + m.x] = i % 2 === 0 ? 1 : 2))
  return canonicalBoardKey(b)
}
const RN = { pos4: new Map(), pos5: new Map(), games: 0, t10: 0 }
// 解析 16.5 萬局要數十秒（背景調查佔 CPU 時更久）→ 統計結果快取成 JSON，XML 沒變就直接讀
const RN_CACHE = path.join(ROOT, 'scratch', 'renjunet', 'stats-cache.json')
const rnMtime = existsSync(RN_FILE) ? statSync(RN_FILE).mtimeMs : 0
const cached = existsSync(RN_CACHE) ? JSON.parse(readFileSync(RN_CACHE, 'utf8')) : null
if (cached && cached.mtime === rnMtime) {
  RN.games = cached.games
  RN.t10 = cached.t10
  RN.pos4 = new Map(cached.pos4)
  RN.pos5 = new Map(cached.pos5)
} else if (existsSync(RN_FILE)) {
  const xml = readFileSync(RN_FILE, 'utf8')
  const re = /<game [^>]*rule="(\d+)"[^>]*bresult="([\d.]+)"[^>]*>\s*<move>([^<]*)<\/move>/g
  const bump = (map, key, t10, br) => {
    const e = map.get(key) ?? { n: 0, b: 0, t10: 0, t10b: 0 }
    e.n++
    e.b += br
    if (t10) {
      e.t10++
      e.t10b += br
    }
    map.set(key, e)
  }
  for (const m of xml.matchAll(re)) {
    const mv = m[3].trim().split(/\s+/).slice(0, 5).map((t) => ({ x: t.charCodeAt(0) - 97, y: 15 - +t.slice(1) }))
    if (mv.length < 4 || mv.some((p) => !(p.x >= 0 && p.x < 15 && p.y >= 0 && p.y < 15))) continue
    const t10 = T10_RULES.has(m[1])
    const br = +m[2]
    RN.games++
    if (t10) RN.t10++
    bump(RN.pos4, keyOf(mv.slice(0, 4)), t10, br)
    if (mv.length >= 5) bump(RN.pos5, keyOf(mv), t10, br)
  }
  writeFileSync(
    RN_CACHE,
    JSON.stringify({ mtime: rnMtime, games: RN.games, t10: RN.t10, pos4: [...RN.pos4], pos5: [...RN.pos5] }),
  )
}
/** 實戰統計文字：「塔拉10 實戰 12 局（黑得分 58%）／全規則 40 局」。 */
function rnText(moves) {
  if (RN.games === 0) return ''
  const e = (moves.length === 4 ? RN.pos4 : RN.pos5).get(keyOf(moves))
  if (!e) return '正式比賽未出現'
  const pct = (b, n) => `${Math.round((b / n) * 100)}%`
  return `塔拉10 實戰 ${e.t10} 局${e.t10 ? `（黑得分 ${pct(e.t10b, e.t10)}）` : ''}／全規則 ${e.n} 局（黑得分 ${pct(e.b, e.n)}）`
}
/** 指南對某白 4 局面中某黑 5 的評價（含鏡像標籤）。 */
const GUIDE_KIND = { win: '黑必勝', winq: '黑勝？', bal: '平衡／白稍優', near: '白近勝', lose: '黑敗' }
function guideWinsOf(opening, w4) {
  const v = GUIDE.find((g) => g.opening === opening && sameP(g.w4, w4))
  return v ? v.labels.filter((l) => l.kind === 'win' || l.kind === 'winq').map((l) => l.pos) : []
}
function guideLabel(opening, w4, b5) {
  const v = GUIDE.find((g) => g.opening === opening && sameP(g.w4, w4))
  const l = v?.labels.find((x) => sameP(x.pos, b5))
  return l ? `${GUIDE_KIND[l.kind]}（第 ${l.rank}${l.prime ? "'" : ''} 打）` : v ? '指南未列' : '—'
}

const name = (p) => `${String.fromCharCode(65 + p.x)}${15 - p.y}`
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
/** 黑方視角分數 → 文字。 */
const fmt = (v) =>
  v === null || v === undefined
    ? '—'
    : v > 20000
      ? `黑必勝（${30000 - v} 步內）`
      : v < -20000
        ? `白必勝（${30000 + v} 步內）`
        : `${v > 0 ? '+' : ''}${v}`
const link = (moves) => `${SITE}${serializeRecord({ rule: 'renju', moves })}`

/** 速查色：黑優藍、白優橘、均衡綠；必勝實心＋M。 */
function heat(v) {
  if (v === null) return { fill: '#888', op: 0.25, label: '' }
  if (v > 20000) return { fill: '#1c7ed6', op: 0.95, label: 'M' }
  if (v < -20000) return { fill: '#e8590c', op: 0.95, label: 'M' }
  if (Math.abs(v) < 100) return { fill: '#2f9e44', op: 0.55, label: '' }
  const a = Math.min(1, Math.abs(v) / 1000)
  return { fill: v > 0 ? '#1c7ed6' : '#e8590c', op: 0.2 + a * 0.55, label: '' }
}

/** 小棋盤：前四手＋9×9 各黑 5 速查色塊＋陷阱字母。 */
function boardSvg(moves, scan, traps, guideWins = []) {
  const N = 15
  const S = 18
  const P = 14
  const W = P * 2 + S * (N - 1)
  const cx = (i) => P + i * S
  let g = `<svg viewBox="0 0 ${W} ${W}" class="mini" xmlns="http://www.w3.org/2000/svg"><rect width="${W}" height="${W}" rx="4" fill="#d9b16a"/>`
  for (let i = 0; i < N; i++)
    g += `<line x1="${cx(0)}" y1="${cx(i)}" x2="${cx(N - 1)}" y2="${cx(i)}" stroke="#7a5a30" stroke-width=".6"/><line x1="${cx(i)}" y1="${cx(0)}" x2="${cx(i)}" y2="${cx(N - 1)}" stroke="#7a5a30" stroke-width=".6"/>`
  for (let i = 0; i < N; i++)
    g += `<text x="${cx(i)}" y="${W - 2}" font-size="7" text-anchor="middle" fill="#5c4422">${String.fromCharCode(65 + i)}</text><text x="5" y="${cx(i) + 2.5}" font-size="7" text-anchor="middle" fill="#5c4422">${N - i}</text>`
  g += `<rect x="${cx(3) - S / 2}" y="${cx(3) - S / 2}" width="${S * 9}" height="${S * 9}" fill="none" stroke="#7a5a30" stroke-dasharray="3 2" stroke-width=".8"/>`
  for (const s of scan.filter((x) => x.in9)) {
    const h = heat(s.score)
    g += `<rect x="${cx(s.pos.x) - 7}" y="${cx(s.pos.y) - 7}" width="14" height="14" rx="3" fill="${h.fill}" fill-opacity="${h.op}"><title>${name(s.pos)}：${fmt(s.score)}</title></rect>`
    if (h.label)
      g += `<text x="${cx(s.pos.x)}" y="${cx(s.pos.y) + 3}" font-size="8" text-anchor="middle" fill="#fff" font-weight="700">${h.label}</text>`
  }
  moves.forEach((m, i) => {
    const black = i % 2 === 0
    g += `<circle cx="${cx(m.x)}" cy="${cx(m.y)}" r="8" fill="${black ? '#111' : '#f4f1ea'}" stroke="${i === 3 ? '#e03131' : '#333'}" stroke-width="${i === 3 ? 2.2 : 0.6}"/><text x="${cx(m.x)}" y="${cx(m.y) + 3.5}" font-size="9.5" text-anchor="middle" fill="${black ? '#fff' : '#111'}" font-family="sans-serif">${i + 1}</text>`
  })
  // 指南的黑必勝點（綠框）：Rapfi 2 秒常算不出深層必勝，以指南補上
  for (const p of guideWins)
    g += `<rect x="${cx(p.x) - 8}" y="${cx(p.y) - 8}" width="16" height="16" rx="3" fill="none" stroke="#2b8a3e" stroke-width="2"><title>指南：黑必勝</title></rect>`
  traps.forEach((t, i) => {
    g += `<circle cx="${cx(t.b5.x)}" cy="${cx(t.b5.y)}" r="8" fill="none" stroke="#ffd43b" stroke-width="2.4"/><text x="${cx(t.b5.x) + 9}" y="${cx(t.b5.y) - 6}" font-size="10" font-weight="800" fill="#7a2e00">${String.fromCharCode(65 + i)}</text>`
  })
  return g + '</svg>'
}

/** 陷阱排序：唯一勝著的步數多 → 最窄那步勝著少。 */
const trapRank = (a, b) => b.onlyMoves - a.onlyMoves || (a.narrow ?? 99) - (b.narrow ?? 99)

const sections = []
const summary = []
for (const o of OPENINGS) {
  const base = openingMoves(o)
  const rowsA = A.filter((r) => r.opening === o.id)
  const rows = B2.filter((r) => r.opening === o.id)
  // 指南來源的白 4 排前面；本站自選的（指南模式前跑的）放後面並標示
  const viable = rows.filter((r) => r.viable).sort((a, b) => !!b.guide - !!a.guide)
  const rejected = rows.filter((r) => !r.viable)
  const guideViable = GUIDE.filter((g) => g.opening === o.id && g.viable).sort((a, b) => b.winCount - a.winCount)
  const cards = viable.map((r) => {
    const moves = [...base, r.w4]
    // 陷阱＝勝方某一步只剩 ≤2 個勝著
    const traps = r.traps
      .filter((t) => t.steps.length > 0 && (t.narrow ?? 99) <= 2)
      .sort(trapRank)
      .slice(0, 4)
    const scored = r.scan.filter((s) => s.score !== null)
    const best = scored.reduce((a, b) => (b.score > a.score ? b : a), scored[0])
    const stepTxt = (t) =>
      t.steps
        .map((st) =>
          st.count === 1
            ? `<span class="only">第 ${st.ply} 手只有 ${name(st.best)}</span>`
            : `第 ${st.ply} 手 ${st.count} 個勝著（${st.moves.slice(0, 4).map(name).join(' ')}${st.moves.length > 4 ? '…' : ''}）`,
        )
        .join('<br>')
    return `
<div class="card">
  <div class="card-head">
    <h3>白 4 <b>${name(r.w4)}</b></h3>
    ${
      r.guide
        ? `<span class="tag guide">指南：${esc(r.guide.variation)}（第 ${r.guide.page} 頁）</span>${r.guide.hard ? `<span class="tag hard">困難變化${/生死/.test(r.guide.notes ?? '') ? '：生死局？' : '：有不確定必勝點'}</span>` : ''}<span class="tag ok">指南黑必勝點 ${r.guide.winCount}（不到 10 → 對方無法十打）</span>${
            r.winCount >= 10 ? `<span class="tag warn">⚠️ 本站 2 秒精算有 ${r.winCount} 個必勝點，與指南不一致，請自行深驗</span>` : `<span class="muted">本站精算 ${r.winCount}</span>`
          }`
        : `<span class="tag self">本站自選</span><span class="tag ok">黑必勝第 5 手 ${r.winCount} 個（不到 10 → 對方無法十打）</span>`
    }
    <span class="muted">黑最佳 ${best ? `${name(best.pos)} ${fmt(best.score)}` : '—'}</span>
    ${RN.games ? `<span class="tag rn">${rnText(moves)}</span>` : ''}
    <a class="open" href="${link(moves)}" target="_blank">在道場擺譜打開 ↗</a>
  </div>
  <div class="card-body">
    <div>${boardSvg(moves, r.scan, traps, guideWinsOf(o.id, r.w4))}<p class="legend">色塊＝Rapfi 2 秒評估該點下黑 5（滑鼠移上去看分數）：<span style="color:#4dabf7">藍＝黑優</span>／<span style="color:#ff922b">橘＝白優</span>／<span style="color:#69db7c">綠＝均衡</span>，M＝算到必勝；<span style="color:#51cf66">綠框＝指南標的黑必勝點</span>；黃圈字母＝陷阱黑 5。</p></div>
    <div class="facts">
      ${
        traps.length
          ? `<table><tr><th>陷阱</th><th>黑 5</th><th>Rapfi 結果</th><th>指南評價</th><th>勝方要走的路（沿 Rapfi 主變化，每步多 PV 數勝著）</th></tr>${traps
              .map(
                (t, i) =>
                  `<tr><td class="letter">${String.fromCharCode(65 + i)}</td><td><a href="${link([...moves, t.b5])}" target="_blank">${name(t.b5)}</a></td><td class="${t.winner === 1 ? 'b' : 'w'}">${fmt(t.score)}</td><td class="muted">${guideLabel(o.id, r.w4, t.b5)}</td><td>${stepTxt(t)}${RN.games ? `<div class="rn-line">${rnText([...moves, t.b5])}</div>` : ''}<div class="pv">主變化：${t.line.map(name).join(' → ')}　<a href="${link([...moves, ...t.line])}" target="_blank">打開 ↗</a></div></td></tr>`,
              )
              .join('')}</table>`
          : `<p class="muted">這手白 4 找不到「路很窄」的陷阱黑 5（已分勝負的黑 5，勝方每步都還有 3 個以上勝著）。速查棋盤仍可用：對方下黑 5 時（②），照色塊選色。</p>`
      }
    </div>
  </div>
</div>`
  })
  summary.push(
    `<tr><td><a href="#${o.id}">${esc(o.name)}</a></td><td>${OPENING_KIND_LABEL[o.kind]}${o.index}</td><td>${esc(o.tendency)}</td><td>${
      guideViable.length
        ? guideViable
            .map((g) => {
              const done = viable.some((r) => sameP(r.w4, g.w4))
              const e = RN.games ? RN.pos4.get(keyOf([...base, g.w4])) : null
              return `<a href="${link([...base, g.w4])}" target="_blank" class="${done ? 'done' : ''}">${esc(g.variation)} ${name(g.w4)}</a>（${g.winCount}${RN.games ? `｜實戰 ${e?.t10 ?? 0}` : ''}）`
            })
            .join('、')
        : '<span class="muted">指南無防十打白 4</span>'
    }</td><td>${viable.length ? `<a href="#${o.id}">${viable.length} 手 →</a>` : rows.length ? '—' : '<span class="muted">計算中</span>'}</td></tr>`,
  )
  if (rowsA.length === 0 && rows.length === 0) continue
  sections.push(`
<section id="${o.id}">
  <h2>${esc(o.name)} <span class="muted">${OPENING_KIND_LABEL[o.kind]}第 ${o.index} 型・主流評價 ${esc(o.tendency)}</span></h2>
  <p class="muted">7×7 內白 4 共 ${rowsA.length} 種（對稱等價只算一次）；精算 ${rows.length} 種，可用 <b>${viable.length}</b> 種${
    rejected.length ? `；精算後十打成立（黑必勝點 ≥ 10）：${rejected.map((r) => `${name(r.w4)}（${r.winCount}）`).join('、')}` : ''
  }。${(() => {
    const sk = SKIPPED.filter((id) => id.startsWith(`${o.id}|`)).map((id) => {
      const [x, y] = id.split('|')[1].split(',').map(Number)
      const g = GUIDE.find((v) => v.opening === o.id && v.w4.x === x && v.w4.y === y)
      return `<a href="${link([...base, { x, y }])}" target="_blank">${g ? esc(g.variation) + ' ' : ''}${name({ x, y })}</a>`
    })
    return sk.length ? `<br><span class="warn-text">⚠️ 以下白 4 讓 Rapfi 多執行緒版在計算中卡死，已略過（可點開用道場擺譜自行研究）：${sk.join('、')}</span>` : ''
  })()}</p>
  ${viable.length ? cards.join('') : `<p class="none">${rows.length ? '試過的白 4 都被十打（黑必勝點 ≥ 10）。' : '尚未計算。'}</p>`}
</section>`)
}

// ---- 推薦精選：陷阱品質（兩步以上唯一勝著 ×2、一步唯一 ×1，取該白 4 最好的 3 個陷阱）
//      ＋冷門加分（塔拉10 實戰 ≤3 局 +1）＋指南與 Rapfi 一致（本站必勝點未超過 9）才入選
const picks = []
for (const r of B2.filter((x) => x.viable && x.guide && x.winCount < 10)) {
  const o = OPENINGS.find((x) => x.id === r.opening)
  const moves = [...openingMoves(o), r.w4]
  const good = r.traps
    .filter((t) => t.steps.length > 0 && t.onlyMoves > 0)
    .sort(trapRank)
    .slice(0, 3)
  if (good.length === 0) continue
  const e = RN.games ? RN.pos4.get(keyOf(moves)) : null
  const rare = RN.games && (e?.t10 ?? 0) <= 3
  const score = good.reduce((a, t) => a + (t.onlyMoves >= 2 ? 2 : 1), 0) + (rare ? 1 : 0)
  picks.push({ r, o, moves, good, score, rare, t10: e?.t10 ?? 0 })
}
// 有 10 秒複驗的：以「複驗後唯一勝著的步數」（前 2 個陷阱合計）為主排序；2 秒判定的唯一常是 1～2 手
for (const p of picks) {
  const vs = p.good
    .slice(0, 2)
    .map((t) => VERIFY[`${p.r.opening}|${p.r.w4.x},${p.r.w4.y}|${t.b5.x},${t.b5.y}`])
    .filter(Boolean)
  p.verifiedUnique = vs.length ? vs.reduce((a, v) => a + v.filter((st) => st.mates.length === 1).length, 0) : -1
  // 陷阱依複驗唯一步數重排（同一白 4 內）
  p.good.sort((a, b) => {
    const u = (t) => VERIFY[`${p.r.opening}|${p.r.w4.x},${p.r.w4.y}|${t.b5.x},${t.b5.y}`]?.filter((st) => st.mates.length === 1).length ?? -1
    return u(b) - u(a)
  })
}
picks.sort(
  (a, b) => b.verifiedUnique - a.verifiedUnique || b.score - a.score || b.good[0].onlyMoves - a.good[0].onlyMoves,
)
const picksHtml = picks
  .slice(0, 12)
  .map(
    (p, i) => `<div class="pick"><h3>${i + 1}. ${esc(p.o.name)}・白 4 <b>${name(p.r.w4)}</b>（指南 ${esc(p.r.guide.variation)}，黑必勝點 ${p.r.guide.winCount}${RN.games ? `，塔拉10 實戰 ${p.t10} 局${p.rare ? '・冷門' : ''}` : ''}）　<a href="#${p.o.id}">詳細 →</a>　<a href="${link(p.moves)}" target="_blank">打開 ↗</a></h3>${p.good
      .map((t) => {
        const v = VERIFY[`${p.r.opening}|${p.r.w4.x},${p.r.w4.y}|${t.b5.x},${t.b5.y}`]
        const winner = t.winner === 1 ? '黑' : '白'
        // 有 10 秒複驗：照實列每步必勝著數（1 個＝真唯一）；沒有：標「2 秒判定」
        const path = v
          ? v
              .map((st) =>
                st.mates.length === 1
                  ? (() => {
                      const planned = t.steps.find((x) => x.ply === st.ply)?.best
                      // 複驗的唯一勝著與主變化不同 → 後續步數是接在主變化那手之後算的，要講清楚
                      return planned && (planned.x !== st.mates[0].x || planned.y !== st.mates[0].y)
                        ? `<span class="warn-text">第 ${st.ply} 手：主變化走 ${name(planned)}，但 10 秒認為只有 ${name(st.mates[0])} 能贏（後續路線以 ${name(planned)} 為準，請另行深驗）</span>`
                        : `<span class="only">第 ${st.ply} 手唯一 ${name(st.mates[0])}</span>`
                    })()
                  : st.mates.length === 0
                    ? `第 ${st.ply} 手 ${name(t.steps.find((x) => x.ply === st.ply)?.best ?? st.top[0].m)}（10 秒未直接算到必勝，下完後${winner}方仍勝）`
                    : `第 ${st.ply} 手 ${st.mates.length} 個勝著（${st.mates.map(name).join('、')}）`,
              )
              .join('、') + '　<span class="verified">✓10 秒複驗</span>'
          : t.steps
              .filter((st) => st.count === 1)
              .map((st) => `<span class="only">第 ${st.ply} 手只有 ${name(st.best)}</span>`)
              .join('、') + '　<span class="muted">（2 秒判定，深算可能多 1 手）</span>'
        return `<div>陷阱黑 5 <b>${name(t.b5)}</b>：<span class="${t.winner === 1 ? 'b' : 'w'}">${fmt(t.score)}</span>，${winner}方要走：${path}　<a href="${link([...p.moves, ...t.line])}" target="_blank">主變化 ↗</a></div>`
      })
      .join('')}</div>`,
  )
  .join('')

const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>塔拉山口-10：防十打白 4 與陷阱黑 5（名人賽備戰）</title>
<style>
body{font-family:-apple-system,"PingFang TC","Noto Sans TC",sans-serif;background:#14121c;color:#e8e4f0;max-width:1150px;margin:0 auto;padding:24px;line-height:1.6}
h1{color:#d8a24a;margin-bottom:4px}h2{color:#d8a24a;border-bottom:1px solid #3a3450;padding-bottom:6px;margin-top:42px}h3{margin:0}
a{color:#74c0fc}.muted{color:#9a93ad;font-size:.9em}.none{background:#262238;padding:10px 14px;border-radius:8px;color:#9a93ad}
.intro{background:#1e1b2a;border:1px solid #3a3450;border-radius:10px;padding:14px 18px}
table{border-collapse:collapse;width:100%;font-size:.92em}th,td{border-bottom:1px solid #3a3450;padding:6px 8px;text-align:left;vertical-align:top}
th{color:#9a93ad;font-weight:600}.pv{font-family:ui-monospace,monospace;font-size:.82em;color:#9a93ad;margin-top:4px}
.card{background:#1e1b2a;border:1px solid #3a3450;border-radius:10px;padding:12px 16px;margin:14px 0}
.card-head{display:flex;gap:14px;align-items:center;flex-wrap:wrap}.card-head h3 b{color:#ffd43b;font-size:1.25em}
.tag{background:#262238;border-radius:6px;padding:2px 8px;font-size:.9em}.tag.ok{background:#2b8a3e;color:#fff}.tag.guide{background:#5f3dc4;color:#fff}.tag.self{background:#495057;color:#fff}.tag.warn{background:#c92a2a;color:#fff}.tag.rn{background:#1864ab;color:#fff}.tag.hard{background:#e67700;color:#fff}.warn-text{color:#ff8787}.verified{color:#51cf66;font-size:.85em}
.picks{counter-reset:pk}.pick{background:#1e1b2a;border:1px solid #5f3dc4;border-radius:10px;padding:10px 14px;margin:10px 0}
.pick h3{margin:0 0 4px}.pick h3 b{color:#ffd43b}.rn-line{font-size:.82em;color:#74c0fc;margin-top:4px}a.done{font-weight:800}
.open{margin-left:auto;font-size:.9em}.card-body{display:flex;gap:18px;align-items:flex-start;margin-top:8px}
.mini{width:280px;flex-shrink:0;border-radius:6px;display:block}.legend{font-size:.78em;color:#9a93ad;max-width:280px}
.facts{flex:1;min-width:0}.letter{font-weight:800;color:#ffd43b}.only{color:#ff8787;font-weight:700}
.b{color:#74c0fc;font-weight:700}.w{color:#ffa94d;font-weight:700}
@media(max-width:800px){.card-body{flex-direction:column}.mini{width:100%;max-width:340px}}
</style></head><body>
<h1>塔拉山口-10：防十打白 4 與陷阱黑 5</h1>
<p class="muted">第十八屆台灣五子棋名人賽備戰｜Rapfi 0.43.02 離線計算（流星／名月／遊星前段用多執行緒 8 緒，其餘因多執行緒版連續搜尋會偶發卡死，改單執行緒 4 行程平行）｜產生時間 ${new Date().toLocaleString('zh-TW', { hour12: false })}</p>
<div class="intro">
<p><b>白 4 來源</b>：優先採用中國「漱星閣」群組整理的《漱星閣開局指南》（2026.4.3 版，共 249 個白 4 變化，其中 203 個黑必勝點不到 10），每開局取黑必勝點最多（最像「黑大優」）的 5 手做陷阱分析；指南的評價直接標在陷阱表裡，可以跟 Rapfi 交叉看。</p>
<p><b>防十打（國手定義）</b>：黑方要有 <b>10 個兩兩不對稱的「必勝」第 5 手</b>，十打才成立；不到 10 個，白就挑那個不必勝的。所以這裡的白 4 不怕「看起來黑大優」，只要黑必勝點不到 10 個就能用。指南的必勝點是漱星閣群組整理的；本站另外對每個黑 5 逐點深算 2 秒（M＝Rapfi 算到必勝）交叉比對，兩邊不一致會標紅提醒。標「本站自選」的是改用指南前，Rapfi 自己找出的白 4。</p>
<p><b>陷阱黑 5</b>：下完黑 5 後局面已分勝負，但勝方接下來得一路下對很窄的路。表格沿 Rapfi 主變化，列出勝方接下來 3 次落子各有幾個勝著（多 PV 6 個候選、各 2 秒），<span class="only">紅字＝那一步只有一手能贏</span>（各開局詳細卡片是每步 2 秒判定，深算常會多找到 1 手，實際是「1～2 手能贏」；最上面「推薦精選」另外每步 10 秒複驗，標 ✓ 的是複驗後的實際勝著數）。用法：③ 你下黑 5、對方選色——選了勝方就得一路下對，選了敗方你照背好的路贏；② 對方下黑 5 時，照速查棋盤選色。</p>
<p><b>限制</b>：這是電腦短時間計算，不是證明。單執行緒每點 2 秒算得較淺，「已分勝負」的黑 5 會比多執行緒少判，所以部分白 4 的陷阱數偏少。必勝點可能漏算（漏算＝白 4 其實沒那麼安全），陷阱的「勝著數」只看前 6 個候選。比賽要用的手，請點「打開 ↗」到道場擺譜，用 Rapfi 想 1～2 分鐘再確認。實戰統計來自 RenjuNet 棋譜庫（${RN.games.toLocaleString()} 局，其中塔拉山口-10 系 ${RN.t10.toLocaleString()} 局；盤面 8 對稱歸一、不分手順），黑得分＝黑勝 1／和 0.5／負 0 的平均；局數少時參考價值有限。RenjuNet 規定棋譜庫僅限離線使用，本報告請勿上傳網路。</p>
</div>
<h2>推薦精選</h2>
<p class="muted">從所有已分析的指南白 4 裡，依「陷阱黑 5 的品質」（勝方有幾步只有唯一勝著）＋「實戰冷門」排序。比賽前建議優先背這幾手：白 4 → 對方三選一 → 走③時你下陷阱黑 5，記住勝方的唯一勝著路線。</p>
<div class="picks">${picksHtml || '<p class="muted">計算中</p>'}</div>
<h2>總覽</h2>
<p class="muted">「指南防十打白 4」列出《漱星閣開局指南》中黑必勝點 &lt; 10 的所有變化（括號＝黑必勝點數｜塔拉山口-10 正式比賽出現局數，越少越冷門；點了直接在道場打開）；<b>粗體</b>＝已做陷阱分析、詳見下方。</p>
<table><tr><th>開局</th><th>型</th><th>主流評價</th><th>指南防十打白 4（黑必勝點）</th><th>陷阱分析</th></tr>${summary.join('')}</table>
${sections.join('')}
</body></html>`
writeFileSync(OUT, html)
console.log(`報告：${OUT}（${sections.length} 個開局，可用白 4 ${B2.filter((r) => r.viable).length} 手）`)
