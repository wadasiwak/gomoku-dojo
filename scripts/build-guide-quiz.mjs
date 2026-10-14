// 《漱星閣開局指南》打點複習頁（離線單檔 HTML，國手個人複習用）：
//   node scripts/parse-opening-guide.mjs guide.html > scratch/white4/guide.json
//   node scripts/build-guide-quiz.mjs [--out ~/opening-guide-quiz.html]
//
// ⚠️ 指南是現任名人整理的內容：只產生離線檔給國手自己複習，不放道場網站、不進 git
// （要公開需名人同意）。
//
// 玩法：題目＝開局＋白 4（照 PDF 原方位），使用者在盤上標出「目標打點」後對答案。
// 目標三段可選：只標黑必勝（綠 aN）／黑優（＋註記為偏黑、黑小優…的點，預設）／不輸（＋平衡）。
// 例：寒預「6 打黑勝 7 打偏黑 8 打偏白…」→ 黑優＝a1～a6＋7 共 7 點，其餘就是白優。
// 對稱盤面：標在指南點的鏡像位置也算對（以前四手盤面的自身對稱群判定）。
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`)
  return i > 0 ? process.argv[i + 1] : d
}
const OUT = arg('out', path.join(homedir(), 'opening-guide-quiz.html'))
const guide = JSON.parse(readFileSync(path.join(ROOT, 'scratch', 'white4', 'guide.json'), 'utf8'))

// 指南用字（簡體）→ 繁體顯示
const T = {
  预: '預', 险: '險', 缅: '緬', 绝: '絕', 怀: '懷', 计: '計', 贪: '貪', 结: '結', 赌: '賭', 应: '應',
  谢: '謝', 胜: '勝', 余: '餘', 败: '敗', 优: '優', 决: '決', 准: '準', 恒: '恆', 银: '銀',
}
const trad = (s) => [...s].map((c) => T[c] ?? c).join('')

const data = guide.map((v) => ({
  page: v.page,
  opening: v.opening,
  openingName: v.openingName,
  name: trad(v.variation),
  notes: v.notes, // 原文（簡體），頁面端解析名次評價
  win: v.winCount,
  viable: v.viable,
  hard: v.hard,
  stones: v.raw.stones,
  labels: v.raw.labels.map((l) => [l.pos.x, l.pos.y, l.kind, l.rank, l.prime ? 1 : 0]),
}))
const openings = [...new Map(guide.map((v) => [v.opening, v.openingName])).entries()]

const html = `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>漱星閣開局指南・打點複習</title>
<style>
:root{--bg:#14121c;--panel:#1e1b2a;--panel2:#262238;--text:#e8e4f0;--muted:#9a93ad;--accent:#d8a24a;--border:#3a3450}
*{box-sizing:border-box}body{margin:0;font-family:-apple-system,"PingFang TC","Noto Sans TC",sans-serif;background:var(--bg);color:var(--text)}
.wrap{max-width:1100px;margin:0 auto;padding:14px}
h1{color:var(--accent);font-size:1.3rem;margin:4px 0}.muted{color:var(--muted);font-size:.88em}
.bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:10px;margin:10px 0}
.bar label{display:flex;align-items:center;gap:6px;font-size:.9em}
select,button,input[type=number]{font:inherit;color:var(--text);background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:6px 10px}
button{cursor:pointer}button.primary{background:var(--accent);color:#1a1300;border-color:var(--accent);font-weight:700}
button:disabled{opacity:.45;cursor:default}
.main{display:grid;grid-template-columns:minmax(0,1fr) 330px;gap:16px;align-items:start}
@media(max-width:820px){.main{grid-template-columns:1fr}.main>div:first-child{order:2}.main>div:last-child{order:1}}
.board{width:100%;max-width:620px;display:block;touch-action:manipulation;user-select:none}
.card{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:12px}
.card h2{margin:0 0 6px;font-size:1.15rem}.card h2 b{color:#ffd43b}
.prompt{font-size:1.05rem;margin:6px 0}.count{font-weight:800;color:#ffd43b}
.btns{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.result{margin-top:10px;padding:10px;border-radius:8px;background:var(--panel2)}
.ok{color:#51cf66}.bad{color:#ff6b6b}.warn{color:#ffd43b}
.notes span{display:inline-block;margin:2px 6px 2px 0;padding:1px 6px;border-radius:6px;background:#2d2940;font-size:.88em}
.legend span{margin-right:10px;font-size:.85em}
.stats{font-size:.88em}.stats table{width:100%;border-collapse:collapse}.stats td{padding:2px 4px;border-bottom:1px solid var(--border)}
.pill{display:inline-block;padding:0 6px;border-radius:6px;font-size:.8em;margin-left:4px}
.pill.v{background:#2b8a3e}.pill.h{background:#e67700}.pill.x{background:#c92a2a}
</style></head><body><div class="wrap">
<h1>漱星閣開局指南・打點複習</h1>
<p class="muted">資料：現任名人提供的《漱星閣開局指南》2026.4.3 版（共 ${data.length} 個白 4 變化）。僅供個人複習，請勿上傳網路或外流。棋盤照 PDF 原方位。</p>
<div class="bar">
  <label>開局 <select id="fOpening"><option value="">全部</option>${openings.map(([id, n]) => `<option value="${id}">${n}</option>`).join('')}</select></label>
  <label>範圍 <select id="fScope"><option value="all">全部變化</option><option value="viable">只看防十打（黑必勝 &lt;10）</option><option value="hard">只看困難變化</option><option value="wrong">錯題本</option></select></label>
  <label>順序 <select id="fOrder"><option value="page">照指南頁序</option><option value="random">隨機</option></select></label>
  <label>要標的點 <select id="fTarget"><option value="black">黑優（必勝＋偏黑）</option><option value="win">只標黑必勝</option><option value="notlose">不輸（＋平衡）</option></select></label>
  <label><input type="checkbox" id="fHard"> 困難模式（先答幾打）</label>
</div>
<div class="main">
  <div><svg id="board" class="board" viewBox="0 0 570 570"></svg>
    <p class="legend muted"><span style="color:#ffd43b">● 你的標記</span><span style="color:#51cf66">◎ 標對</span><span style="color:#ffd43b">⬚ 漏標</span><span style="color:#ff6b6b">✕ 標錯</span>　對答案後會攤開指南全部打點（綠 a＝黑必勝、灰＝平衡／偏、橘 c?＝白近勝、紅 c＝黑敗）。</p></div>
  <div>
    <div class="card" id="qcard"></div>
    <div class="card stats" id="stats"></div>
  </div>
</div>
</div>
<script>
const DATA = ${JSON.stringify(data)};
const KEY = 'guide-quiz-v1';
const store = JSON.parse(localStorage.getItem(KEY) || '{"v":{},"cfg":{}}');
const save = () => localStorage.setItem(KEY, JSON.stringify(store));
const $ = (id) => document.getElementById(id);
const COL = 'ABCDEFGHIJKLMNO';
const nm = (x, y) => COL[x] + (15 - y);

// ---- 註記解析：每個名次（含 ' 那一套）→ 評價類別 black/equal/white ----
// 例："6打黑胜7打偏黑8打偏白9打白近胜其余黑败"、"13-18打白近胜"、"5'白近胜"
function parseNotes(notes) {
  const m = new Map();
  // 用詞：黑胜/黑近胜/黑优/偏黑…→黑優；平衡／沒寫哪方的「有望胜」→平衡；白…→白優；
  // 百分比（黑勝率）≥55 黑優、≤45 白優、其間平衡（例：「7打56%」「4打51%」）
  const re = /(\\d+)(?:-(\\d+))?('?)\\s*打?\\s*(黑胜|黑必胜|黑近胜|黑有望胜|黑大优|黑优|黑小优|偏黑|平衡|偏白|白小优|白优|白大优|白近胜|白有望胜|白胜|黑败|有望胜|\\d+%)/g;
  for (const t of notes.matchAll(re)) {
    const a = +t[1], b = t[2] ? +t[2] : a, prime = t[3] ? 1 : 0, j = t[4];
    const pct = /%$/.test(j) ? parseInt(j) : null;
    const cat = pct !== null ? (pct >= 55 ? 'black' : pct <= 45 ? 'white' : 'equal')
      : /^(黑胜|黑必胜|黑近胜|黑有望胜|黑大优|黑优|黑小优|偏黑)$/.test(j) ? 'black'
      : j === '平衡' || j === '有望胜' ? 'equal' : 'white';
    for (let r = a; r <= b; r++) m.set(r + (prime ? "'" : ''), { cat, text: j });
  }
  return m;
}
const T2 = { 胜: '勝', 余: '餘', 败: '敗', 优: '優' };
const tr = (s) => [...s].map((c) => T2[c] || c).join('');

// ---- 對稱：前四手盤面的自身對稱群（含顏色），標在鏡像點也算對 ----
const SYM = [(x,y)=>[x,y],(x,y)=>[14-x,y],(x,y)=>[x,14-y],(x,y)=>[14-x,14-y],(x,y)=>[y,x],(x,y)=>[14-y,14-x],(x,y)=>[14-y,x],(x,y)=>[y,14-x]];
function stabilizer(stones) {
  const key = (st) => st.map((s, i) => s.x + ',' + s.y + ',' + (i % 2)).sort().join(';');
  const k0 = key(stones);
  return SYM.filter((f) => key(stones.map((s) => { const [x, y] = f(s.x, s.y); return { x, y }; })) === k0);
}

let list = [], idx = 0, marks = new Map(), graded = null, askedCount = null;

function targetsOf(v, mode) {
  const notes = parseNotes(v.notes);
  return v.labels.filter(([x, y, kind, rank, prime]) => {
    if (kind === 'win' || kind === 'winq') return true;
    if (mode === 'win') return false;
    const n = notes.get(rank + (prime ? "'" : ''));
    if (!n) return false;
    return n.cat === 'black' || (mode === 'notlose' && n.cat === 'equal');
  });
}

function buildList() {
  const o = $('fOpening').value, sc = $('fScope').value;
  list = DATA.filter((v) => (!o || v.opening === o) &&
    (sc === 'all' || (sc === 'viable' && v.viable) || (sc === 'hard' && v.hard) || (sc === 'wrong' && store.v[v.page]?.wrong)));
  if ($('fOrder').value === 'random') list.sort(() => Math.random() - 0.5);
  idx = 0;
  store.cfg = { o, sc, ord: $('fOrder').value, t: $('fTarget').value, h: $('fHard').checked }; save();
  show();
}

function show() {
  marks = new Map(); graded = null; askedCount = null;
  const v = list[idx];
  if (!v) { $('qcard').innerHTML = '<p>這個範圍沒有題目' + ($('fScope').value === 'wrong' ? '（錯題本是空的，很棒！）' : '') + '</p>'; draw(); stats(); return; }
  const tg = targetsOf(v, $('fTarget').value);
  const label = { black: '黑優點（黑必勝＋偏黑）', win: '黑必勝點', notlose: '不輸點（黑必勝＋偏黑＋平衡）' }[$('fTarget').value];
  const s = store.v[v.page];
  $('qcard').innerHTML = '<h2>' + v.openingName + '・<b>' + v.name + '</b> <span class="muted">第 ' + (idx + 1) + '/' + list.length + ' 題・指南第 ' + v.page + ' 頁</span>' +
    (v.viable ? '<span class="pill v">防十打</span>' : '<span class="pill x">可十打</span>') + (v.hard ? '<span class="pill h">困難</span>' : '') + '</h2>' +
    (s ? '<p class="muted">紀錄：答過 ' + s.seen + ' 次、連對 ' + s.streak + (s.wrong ? '・在錯題本' : '') + '</p>' : '') +
    ($('fHard').checked
      ? '<p class="prompt">這個白 4 是幾打黑勝？ <input type="number" id="askN" min="0" max="20" style="width:70px"> <button id="askBtn">確定</button></p><p class="prompt muted" id="afterAsk">答完再標出所有' + label + '。</p>'
      : '<p class="prompt">在盤上標出所有<b>' + label + '</b>：共 <span class="count">' + tg.length + '</span> 個（黑必勝 ' + v.win + ' 個）</p>') +
    '<div class="btns"><button class="primary" id="gradeBtn">對答案</button><button id="clearBtn">清除標記</button><button id="revealBtn">直接看答案</button>' +
    '<button id="prevBtn">上一題</button><button id="nextBtn">下一題</button></div><div id="res"></div>';
  $('gradeBtn').onclick = () => grade(false);
  $('revealBtn').onclick = () => grade(true);
  $('clearBtn').onclick = () => { marks.clear(); graded = null; draw(); $('res').innerHTML = ''; };
  $('prevBtn').onclick = () => { if (idx > 0) { idx--; show(); } };
  $('nextBtn').onclick = () => { if (idx < list.length - 1) { idx++; show(); } };
  if ($('fHard').checked) $('askBtn').onclick = () => {
    askedCount = +$('askN').value;
    const ok = askedCount === v.win;
    $('afterAsk').innerHTML = (ok ? '<span class="ok">✓ 正確：' : '<span class="bad">✗ 是 ') + v.win + ' 打黑勝</span>　接著標出所有' + label + '（共 <span class="count">' + tg.length + '</span> 個）。';
  };
  draw(); stats();
}

function grade(revealOnly) {
  const v = list[idx]; if (!v) return;
  const tg = targetsOf(v, $('fTarget').value);
  const syms = stabilizer(v.stones);
  const eq = (a, b) => syms.some((f) => { const [x, y] = f(a[0], a[1]); return x === b[0] && y === b[1]; });
  const hit = [], miss = [], wrong = [];
  for (const t of tg) (([...marks.values()].some((m) => eq(m, t))) ? hit : miss).push(t);
  for (const m of marks.values()) if (!tg.some((t) => eq(m, t))) wrong.push(m);
  graded = { hit, miss, wrong, reveal: true };
  const perfect = !revealOnly && miss.length === 0 && wrong.length === 0 && (askedCount === null || askedCount === v.win);
  if (!revealOnly) {
    const s = store.v[v.page] || { seen: 0, streak: 0, wrong: false };
    s.seen++;
    if (perfect) { s.streak++; if (s.wrong && s.streak >= 2) s.wrong = false; } else { s.streak = 0; s.wrong = true; }
    store.v[v.page] = s; save();
  }
  const notes = parseNotes(v.notes);
  const noteHtml = [...notes.entries()].sort((a, b) => parseInt(a[0]) - parseInt(b[0]) || a[0].length - b[0].length)
    .map(([r, n]) => '<span class="' + (n.cat === 'black' ? 'ok' : n.cat === 'white' ? 'bad' : '') + '">' + r + ' 打 ' + tr(n.text) + '</span>').join('');
  $('res').innerHTML = '<div class="result">' + (revealOnly ? '<b>答案</b>' : perfect ? '<b class="ok">全對！</b>' : '<b class="bad">再加油</b>') +
    (revealOnly ? '' : '　標對 ' + hit.length + '／' + tg.length + (miss.length ? '，<span class="warn">漏 ' + miss.map((t) => nm(t[0], t[1])).join('、') + '</span>' : '') +
      (wrong.length ? '，<span class="bad">多標 ' + wrong.map((m) => nm(m[0], m[1])).join('、') + '</span>' : '')) +
    '<div class="notes" style="margin-top:6px">' + noteHtml + '</div>' +
    (syms.length > 1 ? '<p class="muted">此盤面對稱：標在鏡像位置也算對。</p>' : '') + '</div>';
  draw(); stats();
}

function draw() {
  const v = list[idx]; const S = 36, P = 32, c = (i) => P + i * S;
  let g = '<rect width="570" height="570" rx="8" fill="#c99a55"/>';
  for (let i = 0; i < 15; i++) g += '<line x1="' + c(0) + '" y1="' + c(i) + '" x2="' + c(14) + '" y2="' + c(i) + '" stroke="#6d4f28" stroke-width="1.3"/><line x1="' + c(i) + '" y1="' + c(0) + '" x2="' + c(i) + '" y2="' + c(14) + '" stroke="#6d4f28" stroke-width="1.3"/>';
  for (const [x, y] of [[7,7],[3,3],[11,3],[3,11],[11,11]]) g += '<circle cx="' + c(x) + '" cy="' + c(y) + '" r="4" fill="#6d4f28"/>';
  for (let i = 0; i < 15; i++) g += '<text x="' + c(i) + '" y="565" font-size="11" text-anchor="middle" fill="#6d4f28">' + COL[i] + '</text><text x="10" y="' + (c(i) + 4) + '" font-size="11" text-anchor="middle" fill="#6d4f28">' + (15 - i) + '</text>';
  if (v) {
    const notes = parseNotes(v.notes);
    v.stones.forEach((s, i) => {
      const b = i % 2 === 0;
      g += '<circle cx="' + c(s.x) + '" cy="' + c(s.y) + '" r="16" fill="' + (b ? '#111' : '#f4f1ea') + '" stroke="' + (i === 3 ? '#e03131' : '#333') + '" stroke-width="' + (i === 3 ? 2.5 : 1) + '"/><text x="' + c(s.x) + '" y="' + (c(s.y) + 5) + '" font-size="15" text-anchor="middle" fill="' + (b ? '#fff' : '#111') + '">' + (i + 1) + '</text>';
    });
    // 你的標記：對答案後淡化，讓指南打點文字看得清楚
    for (const m of marks.values()) g += '<circle cx="' + c(m[0]) + '" cy="' + c(m[1]) + '" r="13" fill="#ffd43b" fill-opacity="' + (graded ? '.25' : '.6') + '" stroke="#ffd43b" stroke-width="2"/>';
    if (graded) {
      for (const t of graded.hit) g += '<circle cx="' + c(t[0]) + '" cy="' + c(t[1]) + '" r="16" fill="none" stroke="#51cf66" stroke-width="3.5"/>';
      for (const t of graded.miss) g += '<rect x="' + (c(t[0]) - 15) + '" y="' + (c(t[1]) - 15) + '" width="30" height="30" rx="5" fill="none" stroke="#ffd43b" stroke-width="3" stroke-dasharray="5 3"/>';
      for (const m of graded.wrong) g += '<g stroke="#ff6b6b" stroke-width="4" stroke-linecap="round"><line x1="' + (c(m[0]) - 10) + '" y1="' + (c(m[1]) - 10) + '" x2="' + (c(m[0]) + 10) + '" y2="' + (c(m[1]) + 10) + '"/><line x1="' + (c(m[0]) - 10) + '" y1="' + (c(m[1]) + 10) + '" x2="' + (c(m[0]) + 10) + '" y2="' + (c(m[1]) - 10) + '"/></g>';
    }
    if (graded) for (const [x, y, kind, rank, prime] of v.labels) {
      const n = notes.get(rank + (prime ? "'" : ''));
      const col = kind === 'win' || kind === 'winq' ? '#2f9e44' : kind === 'near' ? '#f08c00' : kind === 'lose' ? '#e03131' : n?.cat === 'black' ? '#1c7ed6' : '#495057';
      const txt = (kind === 'win' || kind === 'winq' ? 'a' : kind === 'near' || kind === 'lose' ? 'c' : '') + rank + (prime ? "'" : '');
      g += '<text x="' + c(x) + '" y="' + (c(y) + 5) + '" font-size="14" font-weight="800" text-anchor="middle" fill="' + col + '" stroke="#fff8e6" stroke-width="3.5" paint-order="stroke">' + txt + '</text>';
    }
    for (let y = 0; y < 15; y++) for (let x = 0; x < 15; x++)
      g += '<rect class="hit" data-x="' + x + '" data-y="' + y + '" x="' + (c(x) - 18) + '" y="' + (c(y) - 18) + '" width="36" height="36" fill="transparent"/>';
  }
  $('board').innerHTML = g;
}

$('board').addEventListener('click', (e) => {
  const r = e.target.closest('.hit'); const v = list[idx];
  if (!r || !v || graded) return;
  const x = +r.dataset.x, y = +r.dataset.y;
  if (v.stones.some((s) => s.x === x && s.y === y)) return;
  const k = x + ',' + y;
  marks.has(k) ? marks.delete(k) : marks.set(k, [x, y]);
  draw();
});

function stats() {
  const byO = new Map();
  for (const v of DATA) {
    const s = store.v[v.page]; const e = byO.get(v.openingName) || { n: 0, done: 0, ok: 0, wrong: 0 };
    e.n++; if (s) { e.done++; if (s.streak > 0) e.ok++; if (s.wrong) e.wrong++; }
    byO.set(v.openingName, e);
  }
  const wrongTotal = Object.values(store.v).filter((s) => s.wrong).length;
  $('stats').innerHTML = '<b>進度</b>　錯題本 ' + wrongTotal + ' 題<table>' +
    [...byO.entries()].map(([n, e]) => '<tr><td>' + n + '</td><td>' + e.done + '/' + e.n + '</td><td class="ok">對 ' + e.ok + '</td><td class="bad">' + (e.wrong ? '錯 ' + e.wrong : '') + '</td></tr>').join('') + '</table>' +
    '<p class="muted">「錯題本」：答錯進本，之後連對 2 次出本。紀錄存在這個瀏覽器。</p>';
}

for (const id of ['fOpening', 'fScope', 'fOrder', 'fTarget', 'fHard']) $(id).addEventListener('change', buildList);
const c0 = store.cfg || {};
if (c0.o !== undefined) { $('fOpening').value = c0.o; $('fScope').value = c0.sc; $('fOrder').value = c0.ord; $('fTarget').value = c0.t; $('fHard').checked = !!c0.h; }
buildList();
</script></body></html>`
writeFileSync(OUT, html)
console.log(`打點複習頁：${OUT}（${data.length} 題）`)
