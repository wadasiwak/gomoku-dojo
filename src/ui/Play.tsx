// 對弈頁：人 vs AI。規則/先後手/難度切換、禁手標記開關、悔棋（悔到自己上一手）、
// 認輸/重開、對局結束記戰績＋自動存棋譜＋分享連結。AI 走 Web Worker 不卡 UI。
import { useEffect, useMemo, useRef, useState } from 'react'
import Board from './Board.tsx'
import { Game } from '../engine/game.ts'
import { EngineClient } from '../engine/client.ts'
import { parseRecord } from '../engine/record.ts'
import { BLACK, WHITE, type Color, type Pos, type Rule } from '../engine/types.ts'
import {
  loadSettings,
  saveSettings,
  recordOutcome,
  saveGame,
  loadStats,
  statKey,
  type Settings,
} from '../storage.ts'
import { navigate } from '../router.ts'

const KIND_LABEL: Record<string, string> = {
  overline: '長連',
  'double-four': '四四',
  'double-three': '三三',
}

declare global {
  interface Window {
    /** e2e 測試 hook（各頁掛自己的方法，unmount 時移除）。 */
    __dojo?: {
      /** 載入棋譜到對弈頁（依棋譜切規則/模式、不觸發 AI 手番以外的行為）。 */
      loadPlay?: (record: string, opts?: { player?: 'black' | 'white' }) => boolean
      /** 開局猜名：回報本題正解名稱。 */
      guessAnswer?: () => string
    }
  }
}

export default function Play({ record }: { record?: string }) {
  const clientRef = useRef<EngineClient | null>(null)
  if (!clientRef.current) clientRef.current = new EngineClient()
  const client = clientRef.current
  useEffect(() => () => clientRef.current?.dispose(), [])

  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [moves, setMoves] = useState<Pos[]>([])
  const [thinking, setThinking] = useState(false)
  const [resigned, setResigned] = useState(false)
  const [gameId, setGameId] = useState(1)
  const [forbidden, setForbidden] = useState<{ index: number; kind: string }[]>([])
  const [copied, setCopied] = useState(false)
  const [, setStatsBump] = useState(0)
  const recordedRef = useRef(false)
  const pendingRef = useRef<string>('')

  const { rule, level, player, showForbidden } = settings
  const playerColor: Color = player === 'black' ? BLACK : WHITE
  const aiColor: Color = player === 'black' ? WHITE : BLACK

  const game = useMemo(() => {
    const g = new Game(rule)
    for (const m of moves) g.play(m.x, m.y)
    return g
  }, [rule, moves])

  const result = resigned
    ? ({ kind: 'win', winner: aiColor, reason: 'resign' } as const)
    : game.result
  const ongoing = result.kind === 'ongoing'

  const updateSettings = (patch: Partial<Settings>, restart: boolean) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    saveSettings(next)
    if (restart) newGame()
  }

  const newGame = () => {
    setMoves([])
    setResigned(false)
    setThinking(false)
    setCopied(false)
    recordedRef.current = false
    pendingRef.current = ''
    setGameId((n) => n + 1)
  }

  // AI 手番：條件成立時發搜索請求；pendingRef 防 StrictMode 重複觸發。
  useEffect(() => {
    if (!ongoing || game.toMove !== aiColor) return
    const key = `${gameId}:${moves.length}`
    if (pendingRef.current === key) return
    pendingRef.current = key
    setThinking(true)
    client
      .search(game.board, aiColor, rule, level)
      .then((r) => {
        if (pendingRef.current !== key || !r.move) return
        const m = r.move
        setMoves((prev) => [...prev, { x: m.x, y: m.y }])
      })
      .finally(() => {
        if (pendingRef.current === key) setThinking(false)
      })
  }, [client, ongoing, game, aiColor, rule, level, moves.length, gameId])

  // renju＋黑手番＋開關開 → 全盤禁手點標記（走 Worker）。
  useEffect(() => {
    let cancelled = false
    if (rule === 'renju' && showForbidden && ongoing && game.toMove === BLACK) {
      client.forbiddenPoints(game.board).then((pts) => {
        if (!cancelled) setForbidden(pts)
      })
    } else {
      setForbidden([])
    }
    return () => {
      cancelled = true
    }
  }, [client, rule, showForbidden, ongoing, game])

  // 對局結束：記戰績（分規則×難度）＋自動存棋譜庫（每局只記一次）。
  useEffect(() => {
    if (result.kind === 'ongoing' || recordedRef.current || moves.length === 0) return
    recordedRef.current = true
    const outcome =
      result.kind === 'draw' ? 'draw' : result.winner === playerColor ? 'win' : 'loss'
    recordOutcome(rule, level, outcome)
    saveGame({
      rule,
      level,
      player,
      outcome,
      reason: result.kind === 'win' ? result.reason : 'draw',
      record: game.serialize(),
    })
    setStatsBump((n) => n + 1) // 戰績列即時刷新
  }, [result, moves.length, rule, level, player, playerColor, game])

  /** 載入棋譜（#/play/<棋譜> 路由與 e2e hook 共用）：只用 setter、不讀 state。 */
  const loadRecord = (recordStr: string, opts?: { player?: 'black' | 'white' }): boolean => {
    const rec = parseRecord(recordStr)
    if (!rec) return false
    const g = Game.fromRecord(rec)
    if (!g) return false
    const next: Settings = {
      ...loadSettings(),
      rule: rec.rule,
      ...(opts?.player ? { player: opts.player } : {}),
    }
    setSettings(next)
    setMoves(rec.moves)
    setResigned(false)
    recordedRef.current = false
    pendingRef.current = ''
    setGameId((n) => n + 1)
    return true
  }

  // #/play/<棋譜>：路由帶譜（開局圖鑑「用此開局對弈」）。
  useEffect(() => {
    if (record) loadRecord(record)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record])

  // e2e 測試 hook。
  useEffect(() => {
    window.__dojo = { ...window.__dojo, loadPlay: loadRecord }
    return () => {
      if (window.__dojo) delete window.__dojo.loadPlay
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onCell = (x: number, y: number) => {
    if (!ongoing || thinking || game.toMove !== playerColor) return
    if (!game.canPlay(x, y)) return
    setMoves((prev) => [...prev, { x, y }])
  }

  /** 悔到自己上一手：先撤掉頂上的 AI 手，再撤自己一手。 */
  const undo = () => {
    if (thinking || moves.length === 0 || resigned) return
    pendingRef.current = `${gameId}:undo:${moves.length}` // 使在途 AI 結果失效
    setMoves((prev) => {
      const ms = [...prev]
      while (ms.length > 0 && (ms.length - 1) % 2 !== (playerColor === BLACK ? 0 : 1))
        ms.pop()
      ms.pop()
      return ms
    })
  }

  const resign = () => {
    if (!ongoing || moves.length === 0) return
    setResigned(true)
  }

  const last = moves[moves.length - 1] ?? null
  const stats = loadStats()[statKey(rule, level)] ?? { win: 0, loss: 0, draw: 0 }

  const statusText = !ongoing
    ? result.kind === 'draw'
      ? '和局'
      : `${result.winner === playerColor ? '你獲勝' : 'AI 獲勝'}（${
          { five: '五連', overline: '長連', forbidden: '黑踩禁手', resign: '認輸' }[
            result.reason
          ]
        }）`
    : thinking
      ? 'AI 思考中…'
      : game.toMove === playerColor
        ? '輪到你落子'
        : '等待 AI'

  const shareUrl = !ongoing
    ? `${location.origin}${location.pathname}#/replay/${game.serialize()}`
    : null

  return (
    <div className="page play-page">
      <div className="board-col">
        <p className={`status${thinking ? ' thinking' : ''}${!ongoing ? ' final' : ''}`}>
          <b>{statusText}</b>
          <span className="muted">　第 {moves.length} 手</span>
          {rule === 'renju' && forbidden.length > 0 && (
            <span className="fb-note">　✕ 黑禁手點</span>
          )}
        </p>
        <Board
          board={game.board}
          lastMove={last}
          forbidden={forbidden.map((f) => ({
            x: f.index % 15,
            y: Math.floor(f.index / 15),
            kind: KIND_LABEL[f.kind] ?? f.kind,
          }))}
          onCell={onCell}
          disabled={!ongoing || thinking || game.toMove !== playerColor}
        />
        {!ongoing && shareUrl && (
          <div className="endgame-bar">
            <button className="btn primary" onClick={newGame}>
              再來一局
            </button>
            <button className="btn" onClick={() => navigate(`replay/${game.serialize()}`)}>
              重播棋譜
            </button>
            <button
              className="btn"
              onClick={() => {
                navigator.clipboard?.writeText(shareUrl).then(() => setCopied(true))
              }}
            >
              {copied ? '已複製連結' : '複製分享連結'}
            </button>
            <span className="muted small">已自動存入棋譜庫</span>
          </div>
        )}
      </div>
      <aside className="panel">
        <h2>對局設定</h2>
        <label>
          規則
          <select
            value={rule}
            onChange={(e) => updateSettings({ rule: e.target.value as Rule }, true)}
            aria-label="規則模式"
          >
            <option value="renju">連珠（黑有禁手）</option>
            <option value="gomoku">無禁手五子棋</option>
          </select>
        </label>
        <label>
          先後手
          <select
            value={player}
            onChange={(e) =>
              updateSettings({ player: e.target.value as 'black' | 'white' }, true)
            }
            aria-label="先後手"
          >
            <option value="black">執黑（先手）</option>
            <option value="white">執白（後手）</option>
          </select>
        </label>
        <label>
          AI 難度
          <select
            value={level}
            onChange={(e) =>
              updateSettings({ level: Number(e.target.value) as 1 | 2 | 3 | 4 }, false)
            }
            aria-label="AI 難度"
          >
            <option value={1}>1 入門</option>
            <option value={2}>2 進階</option>
            <option value={3}>3 高手</option>
            <option value={4}>4 最強</option>
          </select>
        </label>
        {rule === 'renju' && (
          <label className="row">
            <input
              type="checkbox"
              checked={showForbidden}
              onChange={(e) => updateSettings({ showForbidden: e.target.checked }, false)}
            />
            顯示黑禁手點 ✕
          </label>
        )}
        <div className="btn-row">
          <button className="btn" onClick={undo} disabled={thinking || moves.length === 0 || resigned}>
            悔棋
          </button>
          <button className="btn" onClick={resign} disabled={!ongoing || moves.length === 0}>
            認輸
          </button>
          <button className="btn" onClick={newGame}>
            重開
          </button>
        </div>
        <h2>本模式戰績</h2>
        <p className="stats-line" data-stats={statKey(rule, level)}>
          勝 <b>{stats.win}</b>　敗 <b>{stats.loss}</b>　和 <b>{stats.draw}</b>
        </p>
      </aside>
    </div>
  )
}
