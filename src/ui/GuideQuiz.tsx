// 打點複習頁（#/guide）：《漱星閣開局指南》（現任名人整理，經同意收錄）的打點記憶練習。
// 題目＝開局＋白 4（照 PDF 原方位），在盤上標出目標打點後對答案；對完攤開指南全部打點
// 與註記。目標可選：只標黑必勝／黑優（必勝＋偏黑，預設）／不輸（＋平衡）。
// 純邏輯（註記解析、目標、對稱、評分）在 src/guide/quiz.ts；資料 JSON 進頁才載入。
import { useEffect, useMemo, useState } from 'react'
import { getOpening, OPENINGS } from '../content/openings.ts'
import {
  grade,
  labelEval,
  parseNotes,
  stabilizer,
  targetsOf,
  tradText,
  type GradeResult,
  type GuideItem,
  type TargetMode,
} from '../guide/quiz.ts'
import { loadGuideProgress, saveGuideProgress, type GuideProgress } from '../storage.ts'

const COL = 'ABCDEFGHIJKLMNO'
const nm = (x: number, y: number) => `${COL[x]}${15 - y}`
const TARGET_LABEL: Record<TargetMode, string> = {
  black: '黑優點（黑必勝＋偏黑）',
  win: '黑必勝點',
  notlose: '不輸點（黑必勝＋偏黑＋平衡）',
}

export default function GuideQuiz() {
  const [data, setData] = useState<GuideItem[] | null>(null)
  const [prog, setProg] = useState<GuideProgress>(loadGuideProgress)
  const cfg = prog.cfg
  const [idx, setIdx] = useState(0)
  const [marks, setMarks] = useState<[number, number][]>([])
  const [result, setResult] = useState<(GradeResult & { reveal: boolean }) | null>(null)
  const [asked, setAsked] = useState<{ n: number; ok: boolean } | null>(null)
  const [askInput, setAskInput] = useState('')
  const [shuffleSeed, setShuffleSeed] = useState(0)

  useEffect(() => {
    import('../guide/guide-data.json').then((m) => setData(m.default as unknown as GuideItem[]))
  }, [])

  const list = useMemo(() => {
    if (!data) return []
    const l = data.filter(
      (v) =>
        (!cfg.opening || v.opening === cfg.opening) &&
        (cfg.scope === 'all' ||
          (cfg.scope === 'viable' && v.viable) ||
          (cfg.scope === 'hard' && v.hard) ||
          (cfg.scope === 'wrong' && prog.v[v.page]?.wrong)),
    )
    if (cfg.order === 'random') {
      // 洗牌固定在 shuffleSeed（換設定才重洗，不在作答中途跳題）
      let s = shuffleSeed * 9301 + 49297
      const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280)
      for (let i = l.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1))
        ;[l[i], l[j]] = [l[j], l[i]]
      }
    }
    return l
    // 錯題本範圍：作答中不因 prog 變動而重排（只在設定改變時重算）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, cfg.opening, cfg.scope, cfg.order, shuffleSeed])

  const item = list[idx] as GuideItem | undefined
  const mode = cfg.target as TargetMode
  const targets = useMemo(() => (item ? targetsOf(item, mode) : []), [item, mode])

  const resetQ = () => {
    setMarks([])
    setResult(null)
    setAsked(null)
    setAskInput('')
  }
  const go = (i: number) => {
    setIdx(i)
    resetQ()
  }
  const setCfg = (patch: Partial<GuideProgress['cfg']>) => {
    const next = { ...prog, cfg: { ...prog.cfg, ...patch } }
    setProg(next)
    saveGuideProgress(next)
    setShuffleSeed(Date.now() % 100000)
    go(0)
  }

  const onCell = (x: number, y: number) => {
    if (!item || result) return
    if (item.stones.some(([sx, sy]) => sx === x && sy === y)) return
    setMarks((m) => (m.some(([a, b]) => a === x && b === y) ? m.filter(([a, b]) => a !== x || b !== y) : [...m, [x, y]]))
  }

  const check = (revealOnly: boolean) => {
    if (!item) return
    const r = grade(item, mode, marks)
    // reveal＝按「看答案」（不計分）；按「對答案」即使什麼都沒標也算一次作答
    setResult({ ...r, reveal: revealOnly })
    if (revealOnly) return
    const perfect = r.perfect && (asked === null || asked.ok)
    const s = prog.v[item.page] ?? { seen: 0, streak: 0, wrong: false }
    const ns = perfect
      ? { seen: s.seen + 1, streak: s.streak + 1, wrong: s.wrong && s.streak + 1 < 2 }
      : { seen: s.seen + 1, streak: 0, wrong: true }
    const next = { ...prog, v: { ...prog.v, [item.page]: ns } }
    setProg(next)
    saveGuideProgress(next)
  }

  if (!data) return <div className="page">載入指南資料中…</div>

  const notes = item ? parseNotes(item.notes) : new Map()
  const syms = item ? stabilizer(item.stones) : []
  const rec = item ? prog.v[item.page] : undefined
  const perfect = !!result && !result.reveal && result.perfect && (asked === null || asked.ok)
  const wrongTotal = Object.values(prog.v).filter((s) => s.wrong).length

  // ---- 棋盤（PDF 原方位）----
  const S = 36
  const P = 32
  const c = (i: number) => P + i * S
  const board = (
    <svg className="guide-board" viewBox="0 0 570 570" aria-label="打點棋盤">
      <rect width="570" height="570" rx="8" fill="var(--board)" />
      {Array.from({ length: 15 }, (_, i) => (
        <g key={i} stroke="var(--line)" strokeWidth="1.3">
          <line x1={c(0)} y1={c(i)} x2={c(14)} y2={c(i)} />
          <line x1={c(i)} y1={c(0)} x2={c(i)} y2={c(14)} />
        </g>
      ))}
      {[
        [7, 7],
        [3, 3],
        [11, 3],
        [3, 11],
        [11, 11],
      ].map(([x, y]) => (
        <circle key={`s${x}${y}`} cx={c(x)} cy={c(y)} r="4" fill="var(--line)" />
      ))}
      {Array.from({ length: 15 }, (_, i) => (
        <g key={`k${i}`} fontSize="11" fill="var(--line)" textAnchor="middle">
          <text x={c(i)} y="565">
            {COL[i]}
          </text>
          <text x="10" y={c(i) + 4}>
            {15 - i}
          </text>
        </g>
      ))}
      {item?.stones.map(([x, y], i) => (
        <g key={`st${i}`}>
          <circle
            cx={c(x)}
            cy={c(y)}
            r="16"
            fill={i % 2 === 0 ? '#111' : '#f4f1ea'}
            stroke={i === 3 ? '#e03131' : '#333'}
            strokeWidth={i === 3 ? 2.5 : 1}
          />
          <text x={c(x)} y={c(y) + 5} fontSize="15" textAnchor="middle" fill={i % 2 === 0 ? '#fff' : '#111'}>
            {i + 1}
          </text>
        </g>
      ))}
      {marks.map(([x, y]) => (
        <circle
          key={`m${x},${y}`}
          className="guide-mark"
          cx={c(x)}
          cy={c(y)}
          r="13"
          fill="#ffd43b"
          fillOpacity={result ? 0.25 : 0.6}
          stroke="#ffd43b"
          strokeWidth="2"
        />
      ))}
      {result?.hit.map((t) => (
        <circle key={`h${t[0]},${t[1]}`} cx={c(t[0])} cy={c(t[1])} r="16" fill="none" stroke="#51cf66" strokeWidth="3.5" />
      ))}
      {result?.miss.map((t) => (
        <rect
          key={`ms${t[0]},${t[1]}`}
          className="guide-miss"
          x={c(t[0]) - 15}
          y={c(t[1]) - 15}
          width="30"
          height="30"
          rx="5"
          fill="none"
          stroke="#ffd43b"
          strokeWidth="3"
          strokeDasharray="5 3"
        />
      ))}
      {result?.wrong.map(([x, y]) => (
        <g key={`w${x},${y}`} stroke="#ff6b6b" strokeWidth="4" strokeLinecap="round">
          <line x1={c(x) - 10} y1={c(y) - 10} x2={c(x) + 10} y2={c(y) + 10} />
          <line x1={c(x) - 10} y1={c(y) + 10} x2={c(x) + 10} y2={c(y) - 10} />
        </g>
      ))}
      {result &&
        item?.labels.map((l) => {
          const [x, y, kind, rank, prime] = l
          const cat = labelEval(item, l, notes)
          const col =
            kind === 'win' || kind === 'winq'
              ? '#2f9e44'
              : kind === 'near'
                ? '#f08c00'
                : kind === 'lose'
                  ? '#e03131'
                  : cat === 'black'
                    ? '#1c7ed6'
                    : '#495057'
          const txt = `${kind === 'win' || kind === 'winq' ? 'a' : kind === 'near' || kind === 'lose' ? 'c' : ''}${rank}${prime ? "'" : ''}`
          return (
            <text
              key={`l${x},${y}`}
              x={c(x)}
              y={c(y) + 5}
              fontSize="14"
              fontWeight="800"
              textAnchor="middle"
              fill={col}
              stroke="#fff8e6"
              strokeWidth="3.5"
              paintOrder="stroke"
            >
              {txt}
            </text>
          )
        })}
      {Array.from({ length: 225 }, (_, i) => {
        const x = i % 15
        const y = Math.floor(i / 15)
        return (
          <rect
            key={`t${i}`}
            x={c(x) - 18}
            y={c(y) - 18}
            width="36"
            height="36"
            fill="transparent"
            aria-label={`(${x},${y})`}
            style={{ cursor: result ? 'default' : 'pointer' }}
            onClick={() => onCell(x, y)}
          />
        )
      })}
    </svg>
  )

  const opName = item ? (getOpening(item.opening)?.name ?? item.opening) : ''

  return (
    <div className="page guide-page">
      <div className="page-head">
        <h1>打點複習</h1>
        <p className="muted">
          資料：《漱星閣開局指南》2026.4.3 版（現任名人整理，經同意收錄），共 {data.length} 個「開局＋白 4」變化；
          棋盤照指南原方位。標出指定的打點後對答案——白 4 之後該記的就是「哪幾打黑優」，其餘多半是白優。
        </p>
      </div>
      <div className="guide-filters">
        <label>
          開局
          <select value={cfg.opening} onChange={(e) => setCfg({ opening: e.target.value })} aria-label="開局">
            <option value="">全部</option>
            {OPENINGS.filter((o) => data.some((v) => v.opening === o.id)).map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          範圍
          <select value={cfg.scope} onChange={(e) => setCfg({ scope: e.target.value })} aria-label="範圍">
            <option value="all">全部變化</option>
            <option value="viable">只看防十打（黑必勝 &lt; 10）</option>
            <option value="hard">只看困難變化</option>
            <option value="wrong">錯題本（{wrongTotal}）</option>
          </select>
        </label>
        <label>
          順序
          <select value={cfg.order} onChange={(e) => setCfg({ order: e.target.value })} aria-label="順序">
            <option value="page">照指南頁序</option>
            <option value="random">隨機</option>
          </select>
        </label>
        <label>
          要標的點
          <select value={cfg.target} onChange={(e) => setCfg({ target: e.target.value })} aria-label="要標的點">
            <option value="black">黑優（必勝＋偏黑）</option>
            <option value="win">只標黑必勝</option>
            <option value="notlose">不輸（＋平衡）</option>
          </select>
        </label>
        <label className="row">
          <input type="checkbox" checked={cfg.askCount} onChange={(e) => setCfg({ askCount: e.target.checked })} />
          困難模式（先答幾打黑勝）
        </label>
      </div>
      <div className="guide-main">
        <div className="guide-board-col">
          {board}
          <p className="muted small">
            <span style={{ color: '#ffd43b' }}>● 你的標記</span>　<span style={{ color: '#51cf66' }}>◎ 標對</span>
            <span style={{ color: '#ffd43b' }}>⬚ 漏標</span>　<span style={{ color: '#ff6b6b' }}>✕ 標錯</span>
            對答案後攤開指南打點：綠 a＝黑必勝、藍＝偏黑、灰＝平衡／偏白、橘 c?＝白近勝、紅 c＝黑敗。
          </p>
        </div>
        <aside className="panel guide-side">
          {!item ? (
            <p>{cfg.scope === 'wrong' ? '錯題本是空的，很棒！' : '這個範圍沒有題目。'}</p>
          ) : (
            <>
              <h2 className="guide-title">
                {opName}・<b>{item.name}</b>
              </h2>
              <p className="muted small">
                第 {idx + 1}/{list.length} 題・指南第 {item.page} 頁
                {item.viable ? <span className="pill v">防十打</span> : <span className="pill x">可十打</span>}
                {item.hard && <span className="pill h">困難</span>}
                {rec && `　答過 ${rec.seen} 次・連對 ${rec.streak}${rec.wrong ? '・在錯題本' : ''}`}
              </p>
              {cfg.askCount && !asked ? (
                <div className="btn-row">
                  <span>這個白 4 是幾打黑勝？</span>
                  <input
                    type="number"
                    min={0}
                    max={20}
                    value={askInput}
                    onChange={(e) => setAskInput(e.target.value)}
                    aria-label="幾打黑勝"
                    className="guide-ask"
                  />
                  <button className="btn" onClick={() => setAsked({ n: +askInput, ok: +askInput === item.win })}>
                    確定
                  </button>
                </div>
              ) : (
                <>
                  {asked && (
                    <p className={asked.ok ? 'msg ok' : 'msg err'}>
                      {asked.ok ? '✓ 正確' : `✗ 是 ${item.win}`}：{item.win} 打黑勝
                    </p>
                  )}
                  <p className="guide-prompt">
                    標出所有<b>{TARGET_LABEL[mode]}</b>：共 <b className="guide-count">{targets.length}</b> 個
                    {!cfg.askCount && <span className="muted">（黑必勝 {item.win} 個）</span>}
                  </p>
                </>
              )}
              <div className="btn-row">
                <button className="btn primary" onClick={() => check(false)} disabled={!!result || (cfg.askCount && !asked)}>
                  對答案
                </button>
                <button className="btn" onClick={resetQ}>
                  重來
                </button>
                <button className="btn" onClick={() => check(true)} disabled={!!result}>
                  看答案
                </button>
              </div>
              <div className="btn-row">
                <button className="btn" onClick={() => go(idx - 1)} disabled={idx === 0}>
                  上一題
                </button>
                <button className="btn" onClick={() => go(idx + 1)} disabled={idx >= list.length - 1}>
                  下一題
                </button>
              </div>
              {result && (
                <div className="guide-result">
                  {result.reveal ? (
                    <b>答案</b>
                  ) : perfect ? (
                    <b className="ok-text">全對！</b>
                  ) : (
                    <b className="err-text">再加油</b>
                  )}
                  {!result.reveal && (
                    <span>
                      　標對 {result.hit.length}／{targets.length}
                      {result.miss.length > 0 && <span className="warn-text">，漏 {result.miss.map((t) => nm(t[0], t[1])).join('、')}</span>}
                      {result.wrong.length > 0 && <span className="err-text">，多標 {result.wrong.map(([x, y]) => nm(x, y)).join('、')}</span>}
                    </span>
                  )}
                  <div className="guide-notes">
                    {[...notes.entries()]
                      .sort((a, b) => parseInt(a[0], 10) - parseInt(b[0], 10) || a[0].length - b[0].length)
                      .map(([r, n]) => (
                        <span key={r} className={n.cat === 'black' ? 'ok-text' : n.cat === 'white' ? 'err-text' : ''}>
                          {r} 打 {tradText(n.text)}
                        </span>
                      ))}
                  </div>
                  {syms.length > 1 && <p className="muted small">此盤面對稱：標在鏡像位置也算對。</p>}
                </div>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  )
}
