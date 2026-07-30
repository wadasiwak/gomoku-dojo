// 開局圖鑑：RIF 26 珠型卡片牆＋單型詳情＋「開局猜名」練習。
// 珠型名稱/位置/優劣的查證來源見 src/content/openings.ts 檔頭；
// 例圖照 Rules.tsx 樣板——靜態資料重放 + Board crop 小圖。
import { useEffect, useMemo, useState } from 'react'
import Board from './Board.tsx'
import { coordName } from './Replay.tsx'
import {
  OPENINGS,
  OPENING_KIND_LABEL,
  getOpening,
  openingMoves,
  type Opening,
} from '../content/openings.ts'
import { createBoard } from '../engine/board.ts'
import { BLACK, WHITE, idx, type Pos } from '../engine/types.ts'
import { navigate } from '../router.ts'

const CROP = { x0: 4, y0: 4, x1: 10, y1: 10 }

function boardOf(moves: Pos[]): Uint8Array {
  const b = createBoard()
  moves.forEach((m, i) => {
    b[idx(m.x, m.y)] = i % 2 === 0 ? BLACK : WHITE
  })
  return b
}

const tendencyClass = (o: Opening): string =>
  o.level > 0 ? 'blk' : o.level < 0 ? 'wht' : 'even'

function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ---- 卡片牆 ---------------------------------------------------------------

function OpeningCard({ o }: { o: Opening }) {
  return (
    <button className="opening-card" onClick={() => navigate(`openings/${o.id}`)}>
      <Board
        board={boardOf(openingMoves(o))}
        numbered={openingMoves(o)}
        crop={CROP}
        showCoords={false}
        ariaLabel={`${o.name}珠型`}
      />
      <h3>{o.name}</h3>
      <p className="muted small">
        {o.kind === 'direct' ? '直接' : '間接'} {o.index}
        <span className={`badge ${tendencyClass(o)}`}>{o.tendency}</span>
      </p>
    </button>
  )
}

function Grid() {
  return (
    <div className="page">
      <div className="page-head">
        <h1>開局圖鑑：26 珠型</h1>
        <p className="muted">
          連珠的前三手（黑1 天元、白2 中央 3×3、黑3 中央 5×5）經對稱歸類後恰有 26 種
          ——直接開局（白2 直鄰）與間接開局（白2 斜鄰）各 13 種。RIF 正式規約由暫黑
          擺出其中一型，暫白再決定是否換邊。優劣標籤為主流研究傾向，僅供參考。
        </p>
        <div className="btn-row">
          <button className="btn primary" onClick={() => navigate('openings/guess')}>
            開局猜名練習
          </button>
        </div>
      </div>
      <h2 className="opening-section">直接開局（白2 在天元正上）</h2>
      <div className="opening-grid">
        {OPENINGS.filter((o) => o.kind === 'direct').map((o) => (
          <OpeningCard key={o.id} o={o} />
        ))}
      </div>
      <h2 className="opening-section">間接開局（白2 在天元斜上）</h2>
      <div className="opening-grid">
        {OPENINGS.filter((o) => o.kind === 'indirect').map((o) => (
          <OpeningCard key={o.id} o={o} />
        ))}
      </div>
    </div>
  )
}

// ---- 單型詳情 ---------------------------------------------------------------

function Detail({ o }: { o: Opening }) {
  const moves = openingMoves(o)
  const coords = moves
    .map((m, i) => `${i % 2 === 0 ? '黑' : '白'} ${coordName(m)}`)
    .join(' → ')
  return (
    <div className="page">
      <div className="page-head">
        <h1>
          {o.name}
          <span className={`badge ${tendencyClass(o)}`}>{o.tendency}</span>
        </h1>
        <p className="muted">
          {OPENING_KIND_LABEL[o.kind]} 第 {o.index} 型　·　{coords}
        </p>
      </div>
      <div className="opening-detail">
        <div className="opening-detail-board">
          <Board
            board={boardOf(moves)}
            numbered={moves}
            crop={{ x0: 3, y0: 3, x1: 11, y1: 11 }}
            showCoords={false}
            ariaLabel={`${o.name}珠型`}
          />
        </div>
        <div className="opening-detail-text">
          <p>{o.intro}</p>
          <p className="muted small">
            優劣標籤為主流研究傾向（規約換邊前的參考），實戰結果仍取決於雙方功力。
          </p>
          <div className="btn-row">
            <button className="btn primary" onClick={() => navigate(`play/${o.record}`)}>
              用此開局對弈
            </button>
            <button className="btn" onClick={() => navigate(`study/${o.record}`)}>
              載入擺譜
            </button>
            <button className="btn" onClick={() => navigate('openings')}>
              回圖鑑
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---- 開局猜名練習 -----------------------------------------------------------

interface Question {
  q: Opening
  /** 選項（產生當下即 shuffle，正解位置隨機）。 */
  options: string[]
}

function makeQuestion(prevId: string | null): Question {
  const pool = OPENINGS.filter((o) => o.id !== prevId)
  const q = pool[Math.floor(Math.random() * pool.length)]
  const others = shuffle(OPENINGS.filter((o) => o.id !== q.id))
    .slice(0, 3)
    .map((o) => o.name)
  return { q, options: shuffle([q.name, ...others]) }
}

function Guess() {
  const [question, setQuestion] = useState<Question>(() => makeQuestion(null))
  const [answered, setAnswered] = useState<string | null>(null)
  const [score, setScore] = useState({ right: 0, total: 0 })
  const { q, options } = question

  // e2e 測試 hook：回報本題正解名稱。
  useEffect(() => {
    window.__dojo = { ...window.__dojo, guessAnswer: () => q.name }
    return () => {
      if (window.__dojo) delete window.__dojo.guessAnswer
    }
  }, [q])

  const moves = useMemo(() => openingMoves(q), [q])

  const answer = (name: string) => {
    if (answered) return
    setAnswered(name)
    setScore((s) => ({ right: s.right + (name === q.name ? 1 : 0), total: s.total + 1 }))
  }

  const next = () => {
    setQuestion(makeQuestion(q.id))
    setAnswered(null)
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>開局猜名</h1>
        <p className="muted">
          看前三手珠型，猜出它的名字。答對 <b>{score.right}</b> / {score.total}
        </p>
      </div>
      <div className="opening-detail">
        <div className="opening-detail-board">
          <Board
            board={boardOf(moves)}
            numbered={moves}
            crop={{ x0: 3, y0: 3, x1: 11, y1: 11 }}
            showCoords={false}
            ariaLabel="猜名珠型"
          />
        </div>
        <div className="opening-detail-text">
          <div className="guess-opts">
            {options.map((name) => (
              <button
                key={name}
                className={`btn guess-opt${
                  answered
                    ? name === q.name
                      ? ' right'
                      : name === answered
                        ? ' wrong'
                        : ''
                    : ''
                }`}
                disabled={answered !== null}
                onClick={() => answer(name)}
              >
                {name}
              </button>
            ))}
          </div>
          {answered && (
            <>
              <p className={`msg ${answered === q.name ? 'ok' : 'err'}`}>
                {answered === q.name ? '答對了！' : `不對，這是「${q.name}」。`}
                {q.kind === 'direct' ? '直接' : '間接'}開局第 {q.index} 型・{q.tendency}
              </p>
              <p className="muted small">{q.intro}</p>
              <div className="btn-row">
                <button className="btn primary" onClick={next}>
                  下一題
                </button>
                <button className="btn" onClick={() => navigate(`openings/${q.id}`)}>
                  看詳情
                </button>
              </div>
            </>
          )}
          {!answered && (
            <div className="btn-row">
              <button className="btn" onClick={() => navigate('openings')}>
                回圖鑑
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function Openings({ sub }: { sub: string | null }) {
  if (sub === 'guess') return <Guess />
  const o = sub ? getOpening(sub) : undefined
  if (o) return <Detail o={o} />
  return <Grid />
}
