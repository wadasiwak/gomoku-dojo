// 引擎 debug 頁：極簡棋盤（點格落子、禁手點標記、AI 對手、VCF 查詢）。
// 正式 UI 是下一階段；本頁的目的是讓人工驗證引擎行為。
import { useEffect, useMemo, useRef, useState } from 'react'
import { useDojo } from './state.ts'
import { Game } from './engine/game.ts'
import { EngineClient } from './engine/client.ts'
import { SIZE, BLACK, WHITE, idx, type Rule } from './engine/types.ts'
import type { SearchResult } from './engine/search.ts'
import type { VcfResult } from './engine/vcf.ts'

const KIND_LABEL: Record<string, string> = {
  overline: '長連',
  'double-four': '四四',
  'double-three': '三三',
}

export default function App() {
  const { rule, moves, play, undo, reset } = useDojo()
  const clientRef = useRef<EngineClient | null>(null)
  if (!clientRef.current) clientRef.current = new EngineClient()
  const client = clientRef.current

  // 由著手序列重建對局（引擎層負責規則；含踩禁手判負）
  const game = useMemo(() => {
    const g = new Game(rule)
    for (const m of moves) g.play(m.x, m.y)
    return g
  }, [rule, moves])

  const [forbidden, setForbidden] = useState<{ index: number; kind: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [level, setLevel] = useState<1 | 2 | 3 | 4>(2)
  const [aiInfo, setAiInfo] = useState('')

  // renju＋黑手番 → 掃禁手點標記（走 Worker，驗證 message protocol）
  useEffect(() => {
    let cancelled = false
    if (rule === 'renju' && game.toMove === BLACK && game.result.kind === 'ongoing') {
      client.forbiddenPoints(game.board).then((pts) => {
        if (!cancelled) setForbidden(pts)
      })
    } else {
      setForbidden([])
    }
    return () => {
      cancelled = true
    }
  }, [client, rule, game])

  const aiMove = async () => {
    if (busy || game.result.kind !== 'ongoing') return
    setBusy(true)
    try {
      const t0 = Date.now()
      const r = (await client.search(game.board, game.toMove, rule, level)) as SearchResult
      const ms = Date.now() - t0
      if (r.move) {
        play(r.move.x, r.move.y)
        setAiInfo(
          `AI(L${level}) → (${r.move.x},${r.move.y})　${r.viaVcf ? 'VCF!' : `深度${r.depth}`}　${r.nodes} nodes　${ms}ms`,
        )
      }
    } finally {
      setBusy(false)
    }
  }

  const vcfCheck = async () => {
    if (busy) return
    setBusy(true)
    try {
      const color = game.toMove
      const r = (await client.vcf(game.board, color, rule)) as VcfResult
      setAiInfo(
        r.found
          ? `${color === BLACK ? '黑' : '白'}有 VCF：${r.line.map((p) => `(${p.x},${p.y})`).join(' ')}`
          : `${color === BLACK ? '黑' : '白'}無 VCF（${r.truncated ? '搜索被截斷' : '已證實'}）`,
      )
    } finally {
      setBusy(false)
    }
  }

  const last = moves[moves.length - 1]
  const resultText =
    game.result.kind === 'win'
      ? `${game.result.winner === BLACK ? '黑' : '白'}勝（${
          { five: '五連', overline: '長連', forbidden: '對方踩禁手', resign: '對方認輸' }[
            game.result.reason
          ]
        }）`
      : game.result.kind === 'draw'
        ? '和局'
        : `${game.toMove === BLACK ? '黑' : '白'}方落子`

  return (
    <div className="app">
      <h1>五子棋道場 · 引擎 debug 頁</h1>
      <div className="toolbar">
        <select
          value={rule}
          onChange={(e) => reset(e.target.value as Rule)}
          aria-label="規則模式"
        >
          <option value="renju">連珠（黑有禁手）</option>
          <option value="gomoku">無禁手（≥5 即勝）</option>
        </select>
        <button onClick={undo} disabled={moves.length === 0}>
          悔棋
        </button>
        <button onClick={() => reset(rule)} disabled={moves.length === 0}>
          重開
        </button>
        <select
          value={level}
          onChange={(e) => setLevel(Number(e.target.value) as 1 | 2 | 3 | 4)}
          aria-label="AI 難度"
        >
          {[1, 2, 3, 4].map((l) => (
            <option key={l} value={l}>
              AI 難度 {l}
            </option>
          ))}
        </select>
        <button onClick={aiMove} disabled={busy || game.result.kind !== 'ongoing'}>
          {busy ? '思考中…' : 'AI 走一手'}
        </button>
        <button onClick={vcfCheck} disabled={busy}>
          VCF 查詢
        </button>
      </div>
      <p className="status">
        <b>{resultText}</b>　第 {moves.length} 手
        {rule === 'renju' && forbidden.length > 0 && (
          <span className="forbidden-note">　✕ = 黑禁手點（{forbidden.length}）</span>
        )}
      </p>
      <div
        className="board"
        style={{ gridTemplateColumns: `repeat(${SIZE}, 1fr)` }}
        role="grid"
        aria-label="棋盤"
      >
        {Array.from({ length: SIZE * SIZE }, (_, i) => {
          const x = i % SIZE
          const y = Math.floor(i / SIZE)
          const v = game.board[idx(x, y)]
          const fb = forbidden.find((p) => p.index === i)
          const isLast = last && last.x === x && last.y === y
          return (
            <button
              key={i}
              className={`cell${(x === 7 && y === 7) || ((x === 3 || x === 11) && (y === 3 || y === 11)) ? ' star' : ''}`}
              onClick={() => {
                if (game.result.kind === 'ongoing' && v === 0) play(x, y)
              }}
              title={fb ? `禁手：${KIND_LABEL[fb.kind] ?? fb.kind}` : `(${x},${y})`}
              aria-label={`(${x},${y})`}
            >
              {v === BLACK && <span className={`stone black${isLast ? ' last' : ''}`} />}
              {v === WHITE && <span className={`stone white${isLast ? ' last' : ''}`} />}
              {v === 0 && fb && <span className={`fb fb-${fb.kind}`}>✕</span>}
            </button>
          )
        })}
      </div>
      {aiInfo && <p className="ai-info">{aiInfo}</p>}
      <p className="record">
        棋譜：<code>{game.serialize()}</code>
      </p>
      <footer>© 2026 wadasiwak. All rights reserved.</footer>
    </div>
  )
}
