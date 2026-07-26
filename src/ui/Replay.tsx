// 棋譜重播：URL hash 即存檔（#/replay/<棋譜>），還原走嚴格驗證
// （parseRecord 格式/範圍/重複檢查 + Game.fromRecord 逐手合法重播）。
import { useEffect, useMemo, useState } from 'react'
import Board from './Board.tsx'
import { Game } from '../engine/game.ts'
import { parseRecord } from '../engine/record.ts'
import { BLACK, type Pos } from '../engine/types.ts'
import { navigate } from '../router.ts'

export default function Replay({ record }: { record: string }) {
  const parsed = useMemo(() => {
    const rec = parseRecord(record)
    if (!rec) return null
    const g = Game.fromRecord(rec)
    if (!g) return null
    return { rec, final: g }
  }, [record])

  const total = parsed?.rec.moves.length ?? 0
  const [step, setStep] = useState(total)
  const [copied, setCopied] = useState(false)
  useEffect(() => setStep(total), [record, total])

  const game = useMemo(() => {
    if (!parsed) return null
    const g = new Game(parsed.rec.rule)
    for (const m of parsed.rec.moves.slice(0, step)) g.play(m.x, m.y)
    return g
  }, [parsed, step])

  if (!parsed || !game) {
    return (
      <div className="page">
        <h1>棋譜重播</h1>
        <p className="msg err">棋譜連結無效（格式錯誤、座標越界或重複落子）。</p>
        <button className="btn" onClick={() => navigate('')}>
          回首頁
        </button>
      </div>
    )
  }

  const last: Pos | null = step > 0 ? parsed.rec.moves[step - 1] : null
  const result = game.result
  const resultText =
    step < total
      ? `第 ${step} / ${total} 手`
      : result.kind === 'win'
        ? `${result.winner === BLACK ? '黑' : '白'}勝（${
            { five: '五連', overline: '長連', forbidden: '對方踩禁手', resign: '認輸' }[
              result.reason
            ]
          }）`
        : result.kind === 'draw'
          ? '和局'
          : `第 ${step} / ${total} 手（未終局）`

  return (
    <div className="page play-page">
      <div className="board-col">
        <p className="status">
          <b>{resultText}</b>
          <span className="muted">
            　{parsed.rec.rule === 'renju' ? '連珠' : '無禁手'}
          </span>
        </p>
        <Board
          board={game.board}
          lastMove={last}
          numbered={parsed.rec.moves.slice(0, step)}
        />
      </div>
      <aside className="panel">
        <h2>重播控制</h2>
        <div className="btn-row">
          <button className="btn" onClick={() => setStep(0)} disabled={step === 0}>
            ⏮
          </button>
          <button
            className="btn"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
          >
            ◀
          </button>
          <button
            className="btn"
            onClick={() => setStep((s) => Math.min(total, s + 1))}
            disabled={step >= total}
          >
            ▶
          </button>
          <button className="btn" onClick={() => setStep(total)} disabled={step >= total}>
            ⏭
          </button>
        </div>
        <label>
          跳到第 {step} 手
          <input
            type="range"
            min={0}
            max={total}
            value={step}
            onChange={(e) => setStep(Number(e.target.value))}
            aria-label="跳到任一手"
          />
        </label>
        <div className="btn-row">
          <button
            className="btn"
            onClick={() => {
              navigator.clipboard
                ?.writeText(`${location.origin}${location.pathname}#/replay/${record}`)
                .then(() => setCopied(true))
            }}
          >
            {copied ? '已複製連結' : '複製分享連結'}
          </button>
        </div>
        <p className="record-str muted small">
          棋譜：<code data-record={game.serialize()}>{record}</code>
        </p>
      </aside>
    </div>
  )
}
