// 規則科普：禁手三型各一個小盤例圖＋一句話。例圖直接用引擎測資局面渲染，
// ✕ 點的禁手類別由 isForbiddenMove 現場判定（引擎掛保證，不是手畫的）。
import { useMemo } from 'react'
import Board from './Board.tsx'
import { parseBoard } from '../engine/testutils.ts'
import { isForbiddenMove } from '../engine/forbidden.ts'

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

export default function Rules() {
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
    </div>
  )
}
