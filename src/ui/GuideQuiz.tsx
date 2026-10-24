// 打點複習頁（#/guide）：《漱星閣開局指南》（中國「漱星閣」群組整理）／《玄》棋譜庫（名人林書玄整理）
// 的打點記憶練習（資料來源可切換；玄的評等 A～G 直接對到黑優／平衡／白優）。
// 題目＝開局＋白 4（照 PDF 原方位），在盤上標出目標打點後對答案；對完攤開指南全部打點
// 與註記。目標可選：黑優＋平衡分兩色標（預設；國手：平衡點是比賽最常出現的）／只標黑必勝／
// 黑優（必勝＋偏黑）／不輸（＋平衡，不分色）。分兩色模式：點一下黑優（黃）、兩下平衡（藍）、三下取消。
// 純邏輯（註記解析、目標、對稱、評分）在 src/guide/quiz.ts；資料 JSON 進頁才載入。
import { useEffect, useMemo, useState } from 'react'
import { getOpening, OPENINGS } from '../content/openings.ts'
import {
  grade,
  gradeSplit,
  labelEval,
  matchedMark,
  parseNotes,
  stabilizer,
  targetsOf,
  targetsSplit,
  tradText,
  type CatMark,
  type GuideItem,
  type SplitGradeResult,
  type TargetMode,
} from '../guide/quiz.ts'
import { loadGuideProgress, saveGuideProgress, type GuideProgress } from '../storage.ts'
import { xuanIfUnlocked } from '../renlib/vault.ts'
import XuanUnlock from './XuanUnlock.tsx'
import { useT } from '../i18n/index.ts'

const COL = 'ABCDEFGHIJKLMNO'
const nm = (x: number, y: number) => `${COL[x]}${15 - y}`
type Mode = TargetMode | 'split'
const GRADE_NAME: Record<string, string> = { A: '黑必勝', B: '黑大優', C: '黑優', D: '均勢', E: '白優', F: '白大優', G: '白必勝' }
const TARGET_LABEL: Record<Mode, string> = {
  split: '黑優點與平衡點',
  black: '黑優點（黑必勝＋偏黑）',
  win: '黑必勝點',
  notlose: '不輸點（黑必勝＋偏黑＋平衡）',
}
const MARK_COLOR = { black: '#ffd43b', equal: '#4dabf7' } as const
/** 玄的評等字母顏色（對答案後攤開）：A 綠、B/C 藍、D 灰、E/F 橘、G 紅。 */
const GRADE_COLOR: Record<string, string> = {
  A: '#2f9e44',
  B: '#1c7ed6',
  C: '#1c7ed6',
  D: '#495057',
  E: '#f08c00',
  F: '#f08c00',
  G: '#e03131',
}

export default function GuideQuiz() {
  const t = useT()
  const [data, setData] = useState<GuideItem[] | null>(null)
  const [prog, setProg] = useState<GuideProgress>(loadGuideProgress)
  const cfg = prog.cfg
  const [idx, setIdx] = useState(0)
  const [marks, setMarks] = useState<CatMark[]>([])
  const [result, setResult] = useState<(SplitGradeResult & { reveal: boolean }) | null>(null)
  const [asked, setAsked] = useState<{ n: number; ok: boolean } | null>(null)
  const [askInput, setAskInput] = useState('')
  const [shuffleSeed, setShuffleSeed] = useState(0)

  const xuan = cfg.src === 'xuan'
  // 玄是加密資料：本機記得金鑰就直接解，否則顯示密碼框（locked）
  const [locked, setLocked] = useState(false)
  useEffect(() => {
    setData(null)
    setLocked(false)
    if (xuan)
      xuanIfUnlocked().then((b) => (b ? setData(b.items) : setLocked(true)))
    else import('../guide/guide-data.json').then((m) => setData(m.default as unknown as GuideItem[]))
  }, [xuan])

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
  const mode = cfg.target as Mode
  const split = useMemo(() => (item ? targetsSplit(item) : { black: [], equal: [] }), [item])
  const targets = useMemo(
    () => (!item ? [] : mode === 'split' ? [...split.black, ...split.equal] : targetsOf(item, mode)),
    [item, mode, split],
  )

  // 既有使用者的設定一次性切到新的預設（分兩色標）
  useEffect(() => {
    if (prog.cfg.v !== 2) {
      const next = { ...prog, cfg: { ...prog.cfg, target: 'split', v: 2 } }
      setProg(next)
      saveGuideProgress(next)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    setMarks((m) => {
      const cur = m.find((k) => k.x === x && k.y === y)
      const rest = m.filter((k) => k.x !== x || k.y !== y)
      // 分兩色：無 → 黑優 → 平衡 → 無；其他模式：無 ↔ 標記
      if (!cur) return [...rest, { x, y, cat: 'black' }]
      if (mode === 'split' && cur.cat === 'black') return [...rest, { x, y, cat: 'equal' }]
      return rest
    })
  }

  const check = (revealOnly: boolean) => {
    if (!item) return
    const r: SplitGradeResult =
      mode === 'split'
        ? gradeSplit(item, marks)
        : (() => {
            const g = grade(item, mode, marks.map((m) => [m.x, m.y] as [number, number]))
            return {
              hit: g.hit.map((label) => ({ label, cat: 'black' as const })),
              miss: g.miss.map((label) => ({ label, cat: 'black' as const })),
              swapped: [],
              wrong: g.wrong,
              perfect: g.perfect,
            }
          })()
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

  if (!data)
    return (
      <div className="page guide-page">
        {locked ? (
          <>
            <XuanUnlock
              onOpen={(b) => {
                setLocked(false)
                setData(b.items)
              }}
            />
            <p>
              <button className="btn" onClick={() => setCfg({ src: '' })}>
                {t('改用漱星閣指南')}
              </button>
            </p>
          </>
        ) : (
          t('載入指南資料中…')
        )}
      </div>
    )

  const notes = item ? parseNotes(item.notes) : new Map()
  const syms = item ? stabilizer(item.stones) : []
  const rec = item ? prog.v[item.page] : undefined
  const perfect = !!result && !result.reveal && result.perfect && (asked === null || asked.ok)
  const wrongTotal = data.filter((v) => prog.v[v.page]?.wrong).length

  // ---- 棋盤（PDF 原方位）----
  const S = 36
  const P = 32
  const c = (i: number) => P + i * S
  const board = (
    <svg className="guide-board" viewBox="0 0 570 570" aria-label={t('打點棋盤')}>
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
      {marks.map(({ x, y, cat }) => (
        <circle
          key={`m${x},${y}`}
          className={`guide-mark ${cat}`}
          cx={c(x)}
          cy={c(y)}
          r="13"
          fill={MARK_COLOR[cat]}
          fillOpacity={result ? 0.25 : 0.6}
          stroke={MARK_COLOR[cat]}
          strokeWidth="2"
        />
      ))}
      {/* 標對／標反的圈畫在使用者標的那顆（可能是鏡像點），不是資料原本的那一邊 */}
      {result?.hit.map(({ label: lb }) => {
        const m = item && matchedMark(item, marks, lb)
        const [x, y] = m ? [m.x, m.y] : [lb[0], lb[1]]
        return <circle key={`h${lb[0]},${lb[1]}`} className="guide-hit" cx={c(x)} cy={c(y)} r="16" fill="none" stroke="#51cf66" strokeWidth="3.5" />
      })}
      {result?.swapped.map(({ label: lb }) => {
        const m = item && matchedMark(item, marks, lb)
        const [x, y] = m ? [m.x, m.y] : [lb[0], lb[1]]
        return <circle key={`sw${lb[0]},${lb[1]}`} cx={c(x)} cy={c(y)} r="16" fill="none" stroke="#ff922b" strokeWidth="3.5" strokeDasharray="4 3" />
      })}
      {result?.miss.map(({ label: lb, cat }) => (
        <rect
          key={`ms${lb[0]},${lb[1]}`}
          className="guide-miss"
          x={c(lb[0]) - 15}
          y={c(lb[1]) - 15}
          width="30"
          height="30"
          rx="5"
          fill="none"
          stroke={MARK_COLOR[cat]}
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
          const grade = item.grades?.[item.labels.indexOf(l)]
          const col = grade
            ? GRADE_COLOR[grade[0]]
            : kind === 'win' || kind === 'winq'
              ? '#2f9e44'
              : kind === 'near'
                ? '#f08c00'
                : kind === 'lose'
                  ? '#e03131'
                  : cat === 'black'
                    ? '#1c7ed6'
                    : '#495057'
          const txt =
            grade ?? `${kind === 'win' || kind === 'winq' ? 'a' : kind === 'near' || kind === 'lose' ? 'c' : ''}${rank}${prime ? "'" : ''}`
          // 玄的 G（白必勝）一盤常二三十個：淡一點，不搶黑優點的眼
          const faint = grade?.[0] === 'G'
          // 使用者標在鏡像點：標籤字也畫到那顆上（原位置照畫）
          const mm = matchedMark(item, marks, l)
          const mirror = mm && (mm.x !== x || mm.y !== y) ? mm : null
          return [{ x, y }, ...(mirror ? [mirror] : [])].map((at) => (
            <text
              key={`l${at.x},${at.y}`}
              x={c(at.x)}
              y={c(at.y) + 5}
              fontSize={faint ? 11 : 14}
              fontWeight="800"
              opacity={faint ? 0.55 : 1}
              textAnchor="middle"
              fill={col}
              stroke="#fff8e6"
              strokeWidth="3.5"
              paintOrder="stroke"
            >
              {txt}
            </text>
          ))
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

  const opName = item ? (t(getOpening(item.opening)?.name ?? item.opening)) : ''

  return (
    <div className="page guide-page">
      <div className="page-head">
        <h1>{t('打點複習')}</h1>
        <p className="muted">
          {xuan ? (
            <>
              {t('資料：《玄》棋譜庫（名人林書玄整理），共 {n} 個「開局＋白 4」變化；評等 A 黑必勝、B 黑大優、C 黑優、D 均勢、E 白優、F 白大優、G 白必勝（A～C 算黑優點、D 算平衡點）。完整變化可到', { n: data.length })}
              <a href="#/lib">{t('玄庫看譜')}</a>
              {t('一路點下去。')}
            </>
          ) : (
            <>{t('資料：《漱星閣開局指南》2026.4.3 版（中國「漱星閣」群組整理），共 {n} 個「開局＋白 4」變化；棋盤照指南原方位。', { n: data.length })}</>
          )}
          {t('標出指定的打點後對答案——白 4 之後該記的就是「哪幾打黑優」，其餘多半是白優。')}
        </p>
      </div>
      <div className="guide-filters">
        <label>
          {t('資料')}
          <select value={cfg.src ?? ''} onChange={(e) => setCfg({ src: e.target.value, opening: cfg.opening, scope: cfg.scope === 'wrong' ? 'all' : cfg.scope })} aria-label={t('資料來源')}>
            <option value="">{t('漱星閣指南（249）')}</option>
            <option value="xuan">{t('玄・林書玄（979，需密碼）')}</option>
          </select>
        </label>
        <label>
          {t('開局')}
          <select value={cfg.opening} onChange={(e) => setCfg({ opening: e.target.value })} aria-label={t('開局')}>
            <option value="">{t('全部')}</option>
            {OPENINGS.filter((o) => data.some((v) => v.opening === o.id)).map((o) => (
              <option key={o.id} value={o.id}>
                {t(o.name)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('範圍')}
          <select value={cfg.scope} onChange={(e) => setCfg({ scope: e.target.value })} aria-label={t('範圍')}>
            <option value="all">{t('全部變化')}</option>
            <option value="viable">{t('只看防十打（黑必勝 < 10）')}</option>
            <option value="hard">{t('只看困難變化')}</option>
            <option value="wrong">{t('錯題本（{n}）', { n: wrongTotal })}</option>
          </select>
        </label>
        <label>
          {t('順序')}
          <select value={cfg.order} onChange={(e) => setCfg({ order: e.target.value })} aria-label={t('順序')}>
            <option value="page">{xuan ? t('照開局順序') : t('照指南頁序')}</option>
            <option value="random">{t('隨機')}</option>
          </select>
        </label>
        <label>
          {t('要標的點')}
          <select value={cfg.target} onChange={(e) => setCfg({ target: e.target.value })} aria-label={t('要標的點')}>
            <option value="split">{t('黑優＋平衡（分兩色標）')}</option>
            <option value="black">{t('只標黑優（必勝＋偏黑）')}</option>
            <option value="win">{t('只標黑必勝')}</option>
            <option value="notlose">{t('不輸（黑優＋平衡，不分色）')}</option>
          </select>
        </label>
        <label className="row">
          <input type="checkbox" checked={cfg.askCount} onChange={(e) => setCfg({ askCount: e.target.checked })} />
          {t('困難模式（先答幾打黑勝）')}
        </label>
      </div>
      <div className="guide-main">
        <div className="guide-board-col">
          {board}
          <p className="muted small">
            <span className="guide-legend">
              <span style={{ color: MARK_COLOR.black }}>{t('● 黑優標記')}</span>
              {mode === 'split' && <span style={{ color: MARK_COLOR.equal }}>{t('● 平衡標記（點兩下）')}</span>}
              <span style={{ color: '#51cf66' }}>{t('◎ 標對')}</span>
              <span style={{ color: '#ff922b' }}>{t('◌ 顏色標反')}</span>
              <span>{t('⬚ 漏標（框色＝該標的類別）')}</span>
              <span style={{ color: '#ff6b6b' }}>{t('✕ 標錯')}</span>
            </span>
            {xuan
              ? t('對答案後攤開玄的評等：綠 A＝黑必勝、藍 B/C＝黑大優/黑優、灰 D＝均勢、橘 E/F＝白優/白大優、淡紅 G＝白必勝。')
              : t('對答案後攤開指南打點：綠 a＝黑必勝、藍＝偏黑、灰＝平衡／偏白、橘 c?＝白近勝、紅 c＝黑敗。')}
          </p>
        </div>
        <aside className="panel guide-side">
          {!item ? (
            <p>{cfg.scope === 'wrong' ? t('錯題本是空的，很棒！') : t('這個範圍沒有題目。')}</p>
          ) : (
            <>
              <h2 className="guide-title">
                {opName}・<b>{item.name}</b>
              </h2>
              <p className="muted small">
                {t('第 {i}/{n} 題', { i: idx + 1, n: list.length })}
                {xuan ? t('・玄') : t('・指南第 {p} 頁', { p: item.page })}
                {item.viable ? <span className="pill v">{t('防十打')}</span> : <span className="pill x">{t('可十打')}</span>}
                {item.hard && <span className="pill h">{t('困難')}</span>}
                {rec && `　${t('答過 {seen} 次・連對 {streak}', { seen: rec.seen, streak: rec.streak })}${rec.wrong ? t('・在錯題本') : ''}`}
              </p>
              {cfg.askCount && !asked ? (
                <div className="btn-row">
                  <span>{t('這個白 4 是幾打黑勝？')}</span>
                  <input
                    type="number"
                    min={0}
                    max={20}
                    value={askInput}
                    onChange={(e) => setAskInput(e.target.value)}
                    aria-label={t('幾打黑勝')}
                    className="guide-ask"
                  />
                  <button className="btn" onClick={() => setAsked({ n: +askInput, ok: +askInput === item.win })}>
                    {t('確定')}
                  </button>
                </div>
              ) : (
                <>
                  {asked && (
                    <p className={asked.ok ? 'msg ok' : 'msg err'}>
                      {asked.ok ? t('✓ 正確') : t('✗ 是 {n}', { n: item.win })}：{t('{n} 打黑勝', { n: item.win })}
                    </p>
                  )}
                  {mode === 'split' ? (
                    <p className="guide-prompt">
                      {t('標出')} <b style={{ color: MARK_COLOR.black }}>{t('黑優點 {n} 個', { n: split.black.length })}</b>{t('（點一下）')}
                      {t(' 和 ')}<b style={{ color: MARK_COLOR.equal }}>{t('平衡點 {n} 個', { n: split.equal.length })}</b>{t('（點兩下）')}
                      {!cfg.askCount && <span className="muted">{t('（其中黑必勝 {n} 個）', { n: item.win })}</span>}
                    </p>
                  ) : (
                    <p className="guide-prompt">
                      {t('標出所有')}<b>{t(TARGET_LABEL[mode])}</b>{t('：共')} <b className="guide-count">{targets.length}</b> {t('個')}
                      {!cfg.askCount && <span className="muted">{t('（黑必勝 {n} 個）', { n: item.win })}</span>}
                    </p>
                  )}
                </>
              )}
              <div className="btn-row">
                <button className="btn primary" onClick={() => check(false)} disabled={!!result || (cfg.askCount && !asked)}>
                  {t('對答案')}
                </button>
                <button className="btn" onClick={resetQ}>
                  {t('重來')}
                </button>
                <button className="btn" onClick={() => check(true)} disabled={!!result}>
                  {t('看答案')}
                </button>
              </div>
              <div className="btn-row">
                <button className="btn" onClick={() => go(idx - 1)} disabled={idx === 0}>
                  {t('上一題')}
                </button>
                <button className="btn" onClick={() => go(idx + 1)} disabled={idx >= list.length - 1}>
                  {t('下一題')}
                </button>
              </div>
              {result && (
                <div className="guide-result">
                  {result.reveal ? (
                    <b>{t('答案')}</b>
                  ) : perfect ? (
                    <b className="ok-text">{t('全對！')}</b>
                  ) : (
                    <b className="err-text">{t('再加油')}</b>
                  )}
                  {!result.reveal && (
                    <span>
                      　{t('標對 {hit}／{total}', { hit: result.hit.length, total: targets.length })}
                      {result.miss.length > 0 && (
                        <span className="warn-text">
                          {t('，漏 {list}', { list: result.miss.map(({ label: lb, cat }) => `${nm(lb[0], lb[1])}${mode === 'split' ? (cat === 'black' ? t('（黑優）') : t('（平衡）')) : ''}`).join(t('、')) })}
                        </span>
                      )}
                      {result.swapped.length > 0 && (
                        <span className="warn-text">
                          {t('，顏色標反 {list}', { list: result.swapped.map(({ label: lb, want }) => t('{pos}（應為{cat}）', { pos: nm(lb[0], lb[1]), cat: want === 'black' ? t('黑優') : t('平衡') })).join(t('、')) })}
                        </span>
                      )}
                      {result.wrong.length > 0 && <span className="err-text">{t('，多標 {list}', { list: result.wrong.map(([x, y]) => nm(x, y)).join(t('、')) })}</span>}
                    </span>
                  )}
                  {item.grades && (
                    <div className="guide-notes">
                      {[...'ABCDEFG']
                        .map((g) => [g, item.grades!.filter((s) => s[0] === g).length] as const)
                        .filter(([, n]) => n > 0)
                        .map(([g, n]) => (
                          <span key={g} style={{ color: GRADE_COLOR[g] }}>
                            {g}（{t(GRADE_NAME[g])}）× {n}
                          </span>
                        ))}
                      <a href={`#/lib/${item.stones.map(([x, y]) => String.fromCharCode(97 + x, 97 + y)).join('')}`}>{t('在玄庫看後續變化 →')}</a>
                    </div>
                  )}
                  <div className="guide-notes">
                    {[...notes.entries()]
                      .sort((a, b) => parseInt(a[0], 10) - parseInt(b[0], 10) || a[0].length - b[0].length)
                      .map(([r, n]) => (
                        <span key={r} className={n.cat === 'black' ? 'ok-text' : n.cat === 'white' ? 'err-text' : ''}>
                          {t('{r} 打', { r })} {tradText(n.text)}
                        </span>
                      ))}
                  </div>
                  {syms.length > 1 && <p className="muted small">{t('此盤面對稱：標在鏡像位置也算對。')}</p>}
                </div>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  )
}
