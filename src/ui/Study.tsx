// 擺譜研究：自由擺子建局（預設輪流一黑一白；單色/清除工具保留），再切
// 「試下」黑白輪替試招。分析統一走 Rapfi（擺子與試下階段皆可分析）。
// 規則面：試下每手即時判五連/長連勝負；連珠模式黑踩禁手判負、可開
// 全盤禁手點 ✕ 標記。擺子階段不做合法性限制（研究用，任意局面皆可）。
import { useEffect, useMemo, useRef, useState } from 'react'
import Board from './Board.tsx'
import ImportBox from './ImportBox.tsx'
import RapfiPanel from './RapfiPanel.tsx'
import { EngineClient } from '../engine/client.ts'
import { parseRecord } from '../engine/record.ts'
import { createBoard } from '../engine/board.ts'
import { isWinningMove } from '../engine/rules.ts'
import { isForbiddenMove } from '../engine/forbidden.ts'
import type { RapfiInput } from '../analysis/rapfi.ts'
import {
  BLACK,
  WHITE,
  EMPTY,
  idx,
  posOf,
  opponent,
  type Color,
  type Pos,
  type Rule,
} from '../engine/types.ts'

type Tool = 'alternate' | 'black' | 'white' | 'erase'

const KIND_LABEL: Record<string, string> = {
  overline: '長連',
  'double-four': '四四',
  'double-three': '三三',
}

export default function Study({ record }: { record?: string }) {
  const clientRef = useRef<EngineClient | null>(null)
  if (!clientRef.current) clientRef.current = new EngineClient()
  const client = clientRef.current
  useEffect(() => () => clientRef.current?.dispose(), [])

  // #/study/<棋譜>：把棋譜（如開局圖鑑的前三手）鋪成擺譜初始盤面，
  // 手番接在棋譜之後。非法棋譜靜默忽略（擺譜是研究工具，不設錯誤頁）。
  const preset = record ? parseRecord(record) : null

  const [rule, setRule] = useState<Rule>(preset?.rule ?? 'renju')
  const [phase, setPhase] = useState<'setup' | 'play'>('setup')
  const [tool, setTool] = useState<Tool>('alternate')
  const [setup, setSetup] = useState<number[]>(() => {
    const b = [...createBoard()]
    preset?.moves.forEach((m, i) => {
      b[idx(m.x, m.y)] = i % 2 === 0 ? BLACK : WHITE
    })
    return b
  })
  const [first, setFirst] = useState<'black' | 'white'>(
    preset && preset.moves.length % 2 === 1 ? 'white' : 'black',
  )
  const [moves, setMoves] = useState<Pos[]>([])
  const [showFb, setShowFb] = useState(true)
  const [rapfiMove, setRapfiMove] = useState<Pos | null>(null) // Rapfi 建議（hint 圈）
  const [forbidden, setForbidden] = useState<{ index: number; kind: string }[]>([])

  // 試下模擬：從擺好的盤面起、依 first 輪替重放 moves，逐手判勝負/禁手。
  const sim = useMemo(() => {
    const b = Uint8Array.from(setup)
    let toMove: Color = first === 'black' ? BLACK : WHITE
    let over: string | null = null
    for (const m of moves) {
      const color = toMove
      if (
        rule === 'renju' &&
        color === BLACK &&
        isForbiddenMove(b, m.x, m.y).forbidden
      ) {
        b[idx(m.x, m.y)] = color
        over = '黑踩禁手，白勝'
        toMove = opponent(color)
        break
      }
      b[idx(m.x, m.y)] = color
      if (isWinningMove(b, m.x, m.y, color, rule)) {
        over = `${color === BLACK ? '黑' : '白'}連成五，${color === BLACK ? '黑' : '白'}勝`
      }
      toMove = opponent(color)
      if (over) break
    }
    return { board: b, toMove, over }
  }, [setup, moves, first, rule])

  const board = phase === 'setup' ? Uint8Array.from(setup) : sim.board
  const ongoing = phase === 'play' && !sim.over
  const stoneCount = useMemo(() => {
    let black = 0
    let white = 0
    for (const v of board) {
      if (v === BLACK) black++
      else if (v === WHITE) white++
    }
    return { black, white }
  }, [board])

  const clearHint = () => {
    setRapfiMove(null)
  }

  // Rapfi 分析輸入：擺譜是任意局面（手順未必交替）→ 走 board 形式。
  const buildRapfiInput = (): RapfiInput => {
    const black: Pos[] = []
    const white: Pos[] = []
    for (let i = 0; i < sim.board.length; i++) {
      if (sim.board[i] === BLACK) black.push(posOf(i))
      else if (sim.board[i] === WHITE) white.push(posOf(i))
    }
    return { board: { black, white, toMove: sim.toMove } }
  }

  // renju＋試下＋黑手番＋開關開 → 全盤禁手點標記（走 Worker）。
  useEffect(() => {
    let cancelled = false
    if (rule === 'renju' && showFb && ongoing && sim.toMove === BLACK) {
      client.forbiddenPoints(sim.board).then((pts) => {
        if (!cancelled) setForbidden(pts)
      })
    } else {
      setForbidden([])
    }
    return () => {
      cancelled = true
    }
  }, [client, rule, showFb, ongoing, sim])

  const onCell = (x: number, y: number) => {
    const cell = idx(x, y)
    if (phase === 'setup') {
      clearHint() // 盤面變了，舊的 Rapfi 建議圈作廢
      setSetup((prev) => {
        const next = [...prev]
        if (tool === 'erase') next[cell] = EMPTY
        else if (tool === 'alternate') {
          // 輪流擺（預設）：依盤上子數決定下一顆顏色（黑≤白→黑），
          // 點已有子則拿掉——拿掉後子數變了，下一顆顏色自動跟著對。
          if (next[cell] !== EMPTY) next[cell] = EMPTY
          else {
            let nb = 0
            let nw = 0
            for (const v of next) {
              if (v === BLACK) nb++
              else if (v === WHITE) nw++
            }
            next[cell] = nb <= nw ? BLACK : WHITE
          }
        } else if (tool === 'black') next[cell] = next[cell] === BLACK ? EMPTY : BLACK
        else next[cell] = next[cell] === WHITE ? EMPTY : WHITE
        return next
      })
      return
    }
    if (!ongoing || board[cell] !== EMPTY) return
    setMoves((m) => [...m, { x, y }])
    clearHint()
  }

  const startPlay = () => {
    setPhase('play')
    setMoves([])
    clearHint()
  }
  const backToSetup = () => {
    setPhase('setup')
    setMoves([])
    clearHint()
  }

  const statusText =
    phase === 'setup'
      ? `擺譜中：黑 ${stoneCount.black} 子、白 ${stoneCount.white} 子`
      : sim.over
        ? `試下結束：${sim.over}`
        : `試下中：輪${sim.toMove === BLACK ? '黑' : '白'}（第 ${moves.length + 1} 手）`

  return (
    <div className="page play-page">
      <div className="board-col">
        <p className={`status${sim.over && phase === 'play' ? ' final' : ''}`}>
          <b>{statusText}</b>
          <span className="muted">　{rule === 'renju' ? '連珠' : '無禁手'}</span>
          {phase === 'play' && rule === 'renju' && forbidden.length > 0 && (
            <span className="fb-note">　✕ 黑禁手點</span>
          )}
        </p>
        <Board
          board={board}
          lastMove={phase === 'play' ? (moves[moves.length - 1] ?? null) : null}
          numbered={phase === 'play' ? moves : undefined}
          hint={rapfiMove}
          forbidden={forbidden.map((f) => ({
            x: f.index % 15,
            y: Math.floor(f.index / 15),
            kind: KIND_LABEL[f.kind] ?? f.kind,
          }))}
          onCell={onCell}
          disabled={phase === 'play' && !ongoing}
          ariaLabel="擺譜棋盤"
        />
      </div>
      <aside className="panel">
        {phase === 'setup' ? (
          <>
            <h2>擺子</h2>
            <p className="muted small">
              點交點放子／再點一次拿掉；「輪流」自動一黑一白，擺好後開始試下。
            </p>
            <div className="btn-row" role="group" aria-label="擺子工具">
              {(
                [
                  ['alternate', '⚫⚪ 輪流'],
                  ['black', '⚫ 黑子'],
                  ['white', '⚪ 白子'],
                  ['erase', '✕ 清除'],
                ] as const
              ).map(([t, label]) => (
                <button
                  key={t}
                  className={`btn${tool === t ? ' primary' : ''}`}
                  aria-pressed={tool === t}
                  onClick={() => setTool(t)}
                >
                  {label}
                </button>
              ))}
            </div>
            <label>
              規則
              <select
                value={rule}
                onChange={(e) => setRule(e.target.value as Rule)}
                aria-label="規則模式"
              >
                <option value="renju">連珠（黑有禁手）</option>
                <option value="gomoku">無禁手五子棋</option>
              </select>
            </label>
            <label>
              接下來輪誰
              <select
                value={first}
                onChange={(e) => setFirst(e.target.value as 'black' | 'white')}
                aria-label="接下來輪誰"
              >
                <option value="black">黑先</option>
                <option value="white">白先</option>
              </select>
            </label>
            <div className="btn-row">
              <button className="btn primary" onClick={startPlay}>
                開始試下
              </button>
              <button
                className="btn"
                onClick={() => setSetup([...createBoard()])}
                disabled={stoneCount.black + stoneCount.white === 0}
              >
                清空盤面
              </button>
            </div>
            <h2>匯入棋譜</h2>
            <p className="muted small">
              貼上本站棋譜或座標序列（如 h8 i9 g9），驗證後鋪成擺譜初始盤面。
            </p>
            <ImportBox target="study" />
          </>
        ) : (
          <>
            <h2>試下</h2>
            <p className="muted small">
              黑白輪替落子；「Rapfi 分析」標出建議手，點該處即照走。
            </p>
            {rule === 'renju' && (
              <label className="row">
                <input
                  type="checkbox"
                  checked={showFb}
                  onChange={(e) => setShowFb(e.target.checked)}
                />
                顯示黑禁手點 ✕
              </label>
            )}
            <div className="btn-row">
              <button
                className="btn"
                onClick={() => {
                  setMoves((m) => m.slice(0, -1))
                  clearHint()
                }}
                disabled={moves.length === 0}
              >
                悔一手
              </button>
              <button className="btn" onClick={backToSetup}>
                回到擺譜
              </button>
            </div>
            <p className="muted small">試下 {moves.length} 手（回到擺譜會收掉試下）</p>
          </>
        )}
        <RapfiPanel
          buildInput={buildRapfiInput}
          rule={rule}
          positionKey={`${phase}|${rule}|${sim.toMove}|${Array.from(sim.board).join('')}`}
          toMoveLabel={sim.toMove === BLACK ? '黑' : '白'}
          disabled={phase === 'play' && !ongoing}
          onMove={setRapfiMove}
        />
      </aside>
    </div>
  )
}
