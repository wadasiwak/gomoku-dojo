// 棋譜重播：URL hash 即存檔（#/replay/<棋譜>），還原走嚴格驗證
// （parseRecord 格式/範圍/重複檢查 + Game.fromRecord 逐手合法重播）。
// 自由研棋：任一手停下直接點棋盤即岔出變化試下（黑白自動輪替、
// 不改動原棋譜與分享連結），可悔一手/整段收掉，並可按「AI 建議」
// 讓引擎標出目前局面它會下哪（研究「換個方式下是不是就 OK」用）。
import { useEffect, useMemo, useRef, useState } from 'react'
import Board from './Board.tsx'
import { Game } from '../engine/game.ts'
import { EngineClient } from '../engine/client.ts'
import { parseRecord } from '../engine/record.ts'
import { BLACK, type Pos } from '../engine/types.ts'
import { navigate } from '../router.ts'

/** 內部座標 → 連珠慣例座標名（A1 左下）。 */
export function coordName(p: Pos): string {
  return `${String.fromCharCode(65 + p.x)}${15 - p.y}`
}

export default function Replay({ record }: { record: string }) {
  const clientRef = useRef<EngineClient | null>(null)
  if (!clientRef.current) clientRef.current = new EngineClient()
  const client = clientRef.current
  useEffect(() => () => clientRef.current?.dispose(), [])

  const parsed = useMemo(() => {
    const rec = parseRecord(record)
    if (!rec) return null
    const g = Game.fromRecord(rec)
    if (!g) return null
    return { rec, final: g }
  }, [record])

  const total = parsed?.rec.moves.length ?? 0
  const [step, setStep] = useState(total)
  const [trial, setTrial] = useState<Pos[]>([]) // 研棋變化（接在第 step 手之後）
  const [hint, setHint] = useState<Pos | null>(null)
  const [thinking, setThinking] = useState(false)
  const [copied, setCopied] = useState(false)
  const hintReqRef = useRef(0)
  useEffect(() => {
    setStep(total)
    setTrial([])
    setHint(null)
  }, [record, total])

  /** 換手數＝離開變化：收掉研棋與建議。 */
  const goStep = (n: number) => {
    setStep(n)
    setTrial([])
    setHint(null)
    hintReqRef.current++ // 使在途建議失效
  }

  const game = useMemo(() => {
    if (!parsed) return null
    const g = new Game(parsed.rec.rule)
    for (const m of parsed.rec.moves.slice(0, step)) g.play(m.x, m.y)
    for (const m of trial) g.play(m.x, m.y)
    return g
  }, [parsed, step, trial])

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

  const inTrial = trial.length > 0
  const ongoing = game.result.kind === 'ongoing'
  const shown = [...parsed.rec.moves.slice(0, step), ...trial]
  const last: Pos | null = shown[shown.length - 1] ?? null
  const result = game.result
  const winText = (r: typeof result) =>
    r.kind === 'win'
      ? `${r.winner === BLACK ? '黑' : '白'}勝（${
          { five: '五連', overline: '長連', forbidden: '對方踩禁手', resign: '認輸' }[
            r.reason
          ]
        }）`
      : '和局'
  const resultText = inTrial
    ? `研棋中：第 ${step} 手起變化 ${trial.length} 手${ongoing ? '' : `，${winText(result)}`}`
    : step < total
      ? `第 ${step} / ${total} 手`
      : result.kind === 'ongoing'
        ? `第 ${step} / ${total} 手（未終局）`
        : winText(result)

  const onCell = (x: number, y: number) => {
    if (!ongoing || !game.canPlay(x, y)) return
    setTrial((t) => [...t, { x, y }])
    setHint(null)
  }

  const suggest = () => {
    if (!ongoing || thinking) return
    const id = ++hintReqRef.current
    setThinking(true)
    client
      .search(game.board, game.toMove, parsed.rec.rule, 3)
      .then((r) => {
        if (hintReqRef.current === id && r.move) setHint(r.move)
      })
      .finally(() => {
        if (hintReqRef.current === id) setThinking(false)
      })
  }

  return (
    <div className="page play-page">
      <div className="board-col">
        <p className={`status${thinking ? ' thinking' : ''}`}>
          <b>{resultText}</b>
          <span className="muted">
            　{parsed.rec.rule === 'renju' ? '連珠' : '無禁手'}
            {inTrial ? '　變化不影響原棋譜' : ''}
          </span>
        </p>
        <Board
          board={game.board}
          lastMove={last}
          numbered={shown}
          hint={hint}
          onCell={onCell}
          disabled={!ongoing}
        />
      </div>
      <aside className="panel">
        <h2>重播控制</h2>
        <div className="btn-row">
          <button className="btn" onClick={() => goStep(0)} disabled={step === 0 && !inTrial}>
            ⏮
          </button>
          <button
            className="btn"
            onClick={() => goStep(Math.max(0, step - 1))}
            disabled={step === 0 && !inTrial}
          >
            ◀
          </button>
          <button
            className="btn"
            onClick={() => goStep(Math.min(total, step + 1))}
            disabled={step >= total}
          >
            ▶
          </button>
          <button className="btn" onClick={() => goStep(total)} disabled={step >= total}>
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
            onChange={(e) => goStep(Number(e.target.value))}
            aria-label="跳到任一手"
          />
        </label>
        <h2>自由研棋</h2>
        <p className="muted small">
          停在任一手直接點棋盤就能試另一種下法（黑白輪替、可反悔），
          不會改動原棋譜。
        </p>
        <div className="btn-row">
          <button className="btn" onClick={suggest} disabled={!ongoing || thinking}>
            {thinking ? 'AI 思考中…' : 'AI 建議'}
          </button>
          <button
            className="btn"
            onClick={() => {
              setTrial((t) => t.slice(0, -1))
              setHint(null)
            }}
            disabled={!inTrial}
          >
            悔一手
          </button>
          <button
            className="btn"
            onClick={() => {
              setTrial([])
              setHint(null)
            }}
            disabled={!inTrial}
          >
            回到棋譜
          </button>
        </div>
        {hint && (
          <p className="msg ok hint-line">
            AI 建議：<b>{coordName(hint)}</b>（{game.toMove === BLACK ? '黑' : '白'}）
            ——點該處即照走
          </p>
        )}
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
          棋譜：<code data-record={parsed.final.serialize()}>{record}</code>
        </p>
      </aside>
    </div>
  )
}
