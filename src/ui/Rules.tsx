// 規則科普：禁手三型各一個小盤例圖＋一句話。例圖直接用引擎測資局面渲染，
// ✕ 點的禁手類別由 isForbiddenMove 現場判定（引擎掛保證，不是手畫的）。
import { useEffect, useMemo } from 'react'
import Board from './Board.tsx'
import { parseBoard } from '../engine/testutils.ts'
import { isForbiddenMove } from '../engine/forbidden.ts'
import { RULE_SECTIONS, RULE_SOURCE } from '../content/rulesText.ts'

interface Example {
  title: string
  desc: string
  ascii: string
  point: { x: number; y: number }
  crop: { x0: number; y0: number; x1: number; y1: number }
}

const EXAMPLES: Example[] = [
  {
    title: '長連',
    desc: '黑棋一手連成六子以上（白棋長連算勝，黑棋是禁手）。圖中 ✕ 補下去就是六連。',
    ascii: `
      ...............
      ...............
      ...............
      ...............
      ...............
      ...............
      ...............
      ....XXX.XX.....
    `,
    point: { x: 7, y: 7 },
    crop: { x0: 2, y0: 4, x1: 12, y1: 10 },
  },
  {
    title: '三三',
    desc: '黑棋一手同時做出兩個以上「真活三」。圖中 ✕ 同時成橫、直兩個活三。',
    ascii: `
      ...............
      ...............
      ...............
      ...............
      ...............
      .......X.......
      .......X.......
      .....XX........
    `,
    point: { x: 7, y: 7 },
    crop: { x0: 2, y0: 3, x1: 12, y1: 10 },
  },
  {
    title: '四四',
    desc: '黑棋一手同時做出兩個以上的四（含同一直線上的跳四）。圖中 ✕ 橫直各成一個四。',
    ascii: `
      ...............
      ...............
      ...............
      ...............
      .......X.......
      .......X.......
      .......X.......
      ....XXX........
    `,
    point: { x: 7, y: 7 },
    crop: { x0: 2, y0: 2, x1: 12, y1: 10 },
  },
]

const KIND_LABEL: Record<string, string> = {
  overline: '長連',
  'double-four': '四四',
  'double-three': '三三',
}

// 原文每行以開頭符號分型：◎ 小標、● 條列、○ 子選項、１２３ 步驟、※ 附註、其餘為段落。
function lineKind(l: string): 'head' | 'bullet' | 'sub' | 'step' | 'note' | 'para' {
  const c = l[0]
  if (c === '◎') return 'head'
  if (c === '●') return 'bullet'
  if (c === '○') return 'sub'
  if (c === '※') return 'note'
  if (/^[０-９]/.test(c)) return 'step'
  return 'para'
}

// #/rules/<節名> 捲到該節（router 對 rules 之後的路徑段不理會，這裡自己讀）。
function scrollToHashSection() {
  const sub = decodeURIComponent(location.hash.replace(/^#\/rules\/?/, ''))
  if (sub) document.getElementById(sub)?.scrollIntoView({ behavior: 'smooth' })
}

export default function Rules() {
  useEffect(() => {
    scrollToHashSection()
    window.addEventListener('hashchange', scrollToHashSection)
    return () => window.removeEventListener('hashchange', scrollToHashSection)
  }, [])
  const examples = useMemo(
    () =>
      EXAMPLES.map((e) => {
        const { board } = parseBoard(e.ascii)
        const verdict = isForbiddenMove(board, e.point.x, e.point.y)
        return { ...e, board, verdict }
      }),
    [],
  )

  return (
    <div className="page">
      <div className="page-head">
        <h1>連珠禁手速覽</h1>
        <p className="muted">
          連珠規則裡只有黑棋有禁手；踩禁手判負，但同一手若同時成「恰好五連」則黑勝（五連豁免）。
          白棋無禁手、長連也算勝。下面 ✕ 的判定由本站引擎現場計算。
        </p>
      </div>
      <div className="rules-grid">
        {examples.map((e) => (
          <section key={e.title} className="rule-card">
            <h2>
              {e.title}
              <span className="badge hard" data-verdict={e.verdict.kind}>
                引擎判定：{e.verdict.forbidden ? (KIND_LABEL[e.verdict.kind!] ?? '') : '非禁手'}
              </span>
            </h2>
            <Board
              board={e.board}
              forbidden={[{ ...e.point, kind: KIND_LABEL[e.verdict.kind ?? ''] }]}
              crop={e.crop}
              showCoords={false}
              ariaLabel={`${e.title}例圖`}
            />
            <p className="muted">{e.desc}</p>
          </section>
        ))}
      </div>
      <p className="muted small">
        活三的「真活性」是遞迴判定的：能延伸成活四的點若本身是禁手，該三不算活三——
        引擎與題庫都依這套嚴格定義。
      </p>
      <section className="rules-full">
        <h2 id="full">完整規則</h2>
        <p className="muted small">
          以下四節轉載自台灣連珠推廣站《規則》（經站方同意收錄，文字逐字照錄）。原站若有更新以{' '}
          <a href={RULE_SOURCE} target="_blank" rel="noreferrer">
            原站 ↗
          </a>{' '}
          為準。RIF 官方規則全文與更多外部資源見 <a href="#/resources">資源頁</a>。
        </p>
        <nav className="rules-toc">
          {RULE_SECTIONS.map((sec) => (
            <a key={sec.title} href={`#/rules/${sec.title}`} className="badge">
              {sec.title}
            </a>
          ))}
        </nav>
        {RULE_SECTIONS.map((sec) => (
          <section key={sec.title} className="rule-text" id={sec.title}>
            <h3>{sec.title}</h3>
            {sec.lines.map((l, i) => {
              const kind = lineKind(l)
              if (kind === 'head') return <h4 key={i}>{l.slice(1)}</h4>
              if (kind === 'para') return <p key={i}>{l}</p>
              return (
                <p key={i} className={`rl rl-${kind}`}>
                  {l}
                </p>
              )
            })}
            <p className="muted small">
              出處：
              <a href={sec.source} target="_blank" rel="noreferrer">
                {sec.source.replace('https://', '')} ↗
              </a>
            </p>
          </section>
        ))}
      </section>
    </div>
  )
}
