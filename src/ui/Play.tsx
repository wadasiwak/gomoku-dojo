// 對弈頁：人 vs AI。兩種模式並存：
//   - 自由對弈（原行為）：規則/先後手/難度切換、禁手標記、悔棋、認輸/重開。
//   - RIF 正式規約（rif/protocol.ts 純函式 reducer）：暫黑擺 26 珠型前三手 →
//     暫白換邊 → 白 4（任意）→ 黑兩打 → 白擇打 → 正常輪替。換邊會互換執色
//     （playerColor 因此是由 swapped 推導的動態值），戰績按最終執色計。
// AI 走 Web Worker 不卡 UI；AI 手番觸發用 pendingRef key 防 StrictMode 雙效應，
// 悔棋前改 key 使在途結果失效（verify skill 鐵則，兩機制都要保住）。
// 規約的 AI 決策在 UI 層編排 client API：換邊＝eval 前三手取優側；黑兩打＝
// 最強兩個互不等價點（白會挑對黑較差的 → 黑提保底最高的一對）；白擇打＝
// 取對黑較差點。決策附評分顯示。
import { useEffect, useMemo, useRef, useState } from 'react'
import Board from './Board.tsx'
import { coordName } from './Replay.tsx'
import { Game } from '../engine/game.ts'
import { EngineClient } from '../engine/client.ts'
import { parseRecord, serializeRecord } from '../engine/record.ts'
import {
  BLACK,
  WHITE,
  EMPTY,
  SIZE,
  idx,
  posOf,
  opponent,
  type Color,
  type Pos,
  type Rule,
} from '../engine/types.ts'
import {
  rifPhase,
  rifReduce,
  rifRecord,
  rifStateFromRecord,
  finalColor,
  emptyMeta,
  type RifAction,
  type RifMeta,
} from '../rif/protocol.ts'
import {
  getOpening,
  openingMoves,
  BALANCED_POOL,
  OPENING_KIND_LABEL,
} from '../content/openings.ts'
import { SYMMETRIES, canonicalBoardKey } from '../engine/symmetry.ts'
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

const fmtScore = (s: number): string => `${s > 0 ? '+' : ''}${Math.round(s)}`

/** 空點且 Chebyshev 距離 ≤2 內有任一子 → 兩打候選格。 */
function candidateCells(board: Uint8Array | ArrayLike<number>): number[] {
  const out: number[] = []
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      if (board[idx(x, y)] !== EMPTY) continue
      let near = false
      for (let dy = -2; dy <= 2 && !near; dy++)
        for (let dx = -2; dx <= 2 && !near; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || nx >= SIZE || ny < 0 || ny >= SIZE) continue
          if (board[idx(nx, ny)] !== EMPTY) near = true
        }
      if (near) out.push(idx(x, y))
    }
  return out
}

export default function Play({ record }: { record?: string }) {
  const clientRef = useRef<EngineClient | null>(null)
  if (!clientRef.current) clientRef.current = new EngineClient()
  const client = clientRef.current
  useEffect(() => () => clientRef.current?.dispose(), [])

  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [moves, setMoves] = useState<Pos[]>([])
  const [rifMeta, setRifMeta] = useState<RifMeta>(emptyMeta)
  const [offerPick, setOfferPick] = useState<Pos[]>([])
  const [rifError, setRifError] = useState<string | null>(null)
  const [aiNotes, setAiNotes] = useState<string[]>([])
  const [thinking, setThinking] = useState(false)
  const [resigned, setResigned] = useState(false)
  const [gameId, setGameId] = useState(1)
  const [forbidden, setForbidden] = useState<{ index: number; kind: string }[]>([])
  const [copied, setCopied] = useState(false)
  const [, setStatsBump] = useState(0)
  const recordedRef = useRef(false)
  const pendingRef = useRef<string>('')
  const aiOpeningRef = useRef<{ gameId: number; moves: Pos[]; name: string } | null>(null)

  const { level, player, showForbidden, mode } = settings
  const rule: Rule = mode === 'rif' ? 'renju' : settings.rule
  /** 規約模式下 player＝「暫定執色」；最終執色由換邊決定推導。 */
  const tentColor: Color = player === 'black' ? BLACK : WHITE
  const playerColor: Color = mode === 'rif' ? finalColor(tentColor, rifMeta.swapped) : tentColor
  const aiColor: Color = opponent(playerColor)

  const game = useMemo(() => {
    const g = new Game(rule)
    for (const m of moves) g.play(m.x, m.y)
    return g
  }, [rule, moves])

  const phase = mode === 'rif' ? rifPhase({ moves, meta: rifMeta }) : 'normal'

  const result = resigned
    ? ({ kind: 'win', winner: aiColor, reason: 'resign' } as const)
    : game.result
  const ongoing = result.kind === 'ongoing'

  const opening = rifMeta.openingId ? getOpening(rifMeta.openingId) : undefined

  const updateSettings = (patch: Partial<Settings>, restart: boolean) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    saveSettings(next)
    if (restart) newGame()
  }

  const newGame = () => {
    setMoves([])
    setRifMeta(emptyMeta())
    setOfferPick([])
    setRifError(null)
    setAiNotes([])
    setResigned(false)
    setThinking(false)
    setCopied(false)
    recordedRef.current = false
    pendingRef.current = ''
    aiOpeningRef.current = null
    setGameId((n) => n + 1)
  }

  /** 規約動作統一入口：非法動作顯示錯誤、state 不動。 */
  const dispatch = (action: RifAction): boolean => {
    const { next, error } = rifReduce({ moves, meta: rifMeta }, action)
    if (error) {
      setRifError(error)
      return false
    }
    setRifError(null)
    setMoves(next.moves)
    setRifMeta(next.meta)
    return true
  }

  // AI 手番（自由模式全程；規約模式的白 4 與正常輪替）：
  // pendingRef 防 StrictMode 重複觸發。
  useEffect(() => {
    if (!ongoing || game.toMove !== aiColor) return
    if (mode === 'rif' && phase !== 'move4' && phase !== 'normal') return
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
  }, [client, ongoing, game, aiColor, rule, level, moves.length, gameId, mode, phase])

  // 規約流程的 AI 決策（擺開局/換邊/兩打/擇打）。與上面的搜索 effect 互斥
  // （phase 條件不重疊），共用 pendingRef 防雙觸發。
  useEffect(() => {
    if (mode !== 'rif' || !ongoing) return
    const actorIsAi =
      phase === 'opening'
        ? tentColor === WHITE // 我是暫白 → 暫黑（擺開局者）是 AI
        : phase === 'swap'
          ? tentColor === BLACK // 我是暫黑 → 暫白（換邊決定者）是 AI
          : phase === 'offer5'
            ? aiColor === BLACK
            : phase === 'choose5'
              ? aiColor === WHITE
              : false
    if (!actorIsAi) return
    const key = `${gameId}:rif:${phase}:${moves.length}`
    if (pendingRef.current === key) return
    pendingRef.current = key

    if (phase === 'opening') {
      // AI 暫黑：從均衡池抽一型＋隨機對稱方位，逐手擺（每次 effect 擺一手）。
      if (!aiOpeningRef.current || aiOpeningRef.current.gameId !== gameId) {
        const o = BALANCED_POOL[Math.floor(Math.random() * BALANCED_POOL.length)]
        const t = SYMMETRIES[Math.floor(Math.random() * SYMMETRIES.length)]
        aiOpeningRef.current = {
          gameId,
          moves: openingMoves(o).map((m) => t(m.x, m.y)),
          name: o.name,
        }
      }
      const pos = aiOpeningRef.current.moves[moves.length]
      const name = aiOpeningRef.current.name
      setTimeout(() => {
        if (pendingRef.current !== key) return
        dispatch({ type: 'place', pos })
        if (moves.length === 2) setAiNotes((n) => [...n, `AI（暫黑）擺出開局：${name}`])
      }, 300)
      return
    }
    if (phase === 'swap') {
      // 換邊＝取前三手局面的優側。評估分兩層：
      //   1) 26 珠型主流評價（openings 資料）＝比本站引擎更強的開局知識——
      //      純靜態 eval 只看見黑 2 子 vs 白 1 子的材料差，會連彗星/遊星
      //      （主流白必勝型）都換邊，國手一眼看破；
      //   2) 約均衡型（level 0）主流無定論 → 用偶+奇兩個深度的搜索平均
      //      （白視角；單一深度的分數被「誰下最後一手」的 tempo 奇偶偏置主導）。
      if (opening && opening.level !== 0) {
        const swap = opening.level > 0
        setTimeout(() => {
          if (pendingRef.current !== key) return
          dispatch({ type: 'swap', swap })
          setAiNotes((n) => [
            ...n,
            `AI（暫白）${swap ? '換邊改執黑' : '不換邊'}：${opening.name}主流評價${opening.tendency}`,
          ])
        }, 300)
      } else {
        setThinking(true)
        Promise.all([
          client.search(game.board, WHITE, 'renju', 2),
          client.search(game.board, WHITE, 'renju', 3),
        ])
          .then(([a, b]) => {
            if (pendingRef.current !== key) return
            const s = (a.score + b.score) / 2
            const swap = s < 0
            dispatch({ type: 'swap', swap })
            setAiNotes((n) => [
              ...n,
              `AI（暫白）${swap ? '換邊改執黑' : '不換邊'}：${
                opening ? `${opening.name}主流約均衡，` : ''
              }白方搜索評估 ${fmtScore(s)}`,
            ])
          })
          .finally(() => {
            if (pendingRef.current === key) setThinking(false)
          })
      }
      return
    }
    if (phase === 'offer5') {
      // 黑兩打：白會擇「對黑較差」點 → 黑提保底最高的一對＝最強兩個互不等價點。
      setThinking(true)
      const board = game.board
      client
        .forbiddenPoints(board)
        .then((fps) => {
          const bad = new Set(fps.map((f) => f.index))
          const cells = candidateCells(board).filter((c) => !bad.has(c))
          return client.evalMoves(board, BLACK, 'renju', cells)
        })
        .then((scored) => {
          if (pendingRef.current !== key) return
          scored.sort((a, z) => z.score - a.score)
          const keyWith = (cell: number): string => {
            const b = Uint8Array.from(board)
            b[cell] = BLACK
            return canonicalBoardKey(b)
          }
          const a = scored[0]
          const aKey = keyWith(a.cell)
          let b = scored[1]
          for (let i = 1; i < scored.length; i++) {
            if (keyWith(scored[i].cell) !== aKey) {
              b = scored[i]
              break
            }
          }
          const pa = posOf(a.cell)
          const pb = posOf(b.cell)
          if (dispatch({ type: 'offer', a: pa, b: pb }))
            setAiNotes((n) => [
              ...n,
              `AI（黑）兩打：A ${coordName(pa)}（${fmtScore(a.score)}）／B ${coordName(pb)}（${fmtScore(b.score)}）`,
            ])
        })
        .finally(() => {
          if (pendingRef.current === key) setThinking(false)
        })
      return
    }
    if (phase === 'choose5') {
      // 白擇打：兩點各試落黑子後取「對黑較差」點。
      setThinking(true)
      const [a, b] = rifMeta.offers!
      client
        .evalMoves(game.board, BLACK, 'renju', [idx(a.x, a.y), idx(b.x, b.y)])
        .then((scored) => {
          if (pendingRef.current !== key || scored.length < 2) return
          const [ra, rb] = scored
          const pickA = ra.score <= rb.score
          const pick = pickA ? a : b
          const low = pickA ? ra.score : rb.score
          const high = pickA ? rb.score : ra.score
          if (dispatch({ type: 'choose', pos: pick }))
            setAiNotes((n) => [
              ...n,
              `AI（白）擇 ${coordName(pick)}：黑方評分 ${fmtScore(low)}（棄 ${coordName(pickA ? b : a)} ${fmtScore(high)}）`,
            ])
        })
        .finally(() => {
          if (pendingRef.current === key) setThinking(false)
        })
      return
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, ongoing, phase, tentColor, aiColor, moves, gameId, client, game, rifMeta])

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

  /** 目前狀態的棋譜字串（規約模式帶 v2 事件）。 */
  const recordStr =
    mode === 'rif' ? serializeRecord(rifRecord({ moves, meta: rifMeta })) : game.serialize()

  // 對局結束：記戰績（分規則×難度，按最終執色）＋自動存棋譜庫（每局只記一次）。
  useEffect(() => {
    if (result.kind === 'ongoing' || recordedRef.current || moves.length === 0) return
    recordedRef.current = true
    const outcome =
      result.kind === 'draw' ? 'draw' : result.winner === playerColor ? 'win' : 'loss'
    recordOutcome(rule, level, outcome)
    saveGame({
      rule,
      level,
      player: playerColor === BLACK ? 'black' : 'white',
      outcome,
      reason: result.kind === 'win' ? result.reason : 'draw',
      record: recordStr,
      mode,
    })
    setStatsBump((n) => n + 1) // 戰績列即時刷新
  }, [result, moves.length, rule, level, playerColor, recordStr, mode])

  /** 載入棋譜（#/play/<棋譜> 路由與 e2e hook 共用）：只用 setter、不讀 state。
   *  v2 棋譜先過 rifStateFromRecord 深度驗證並還原規約狀態＋切規約模式。 */
  const loadRecord = (recordStr: string, opts?: { player?: 'black' | 'white' }): boolean => {
    const rec = parseRecord(recordStr)
    if (!rec) return false
    let meta = emptyMeta()
    if (rec.rif) {
      const st = rifStateFromRecord(rec)
      if (!st) return false
      meta = st.meta
    }
    const g = Game.fromRecord(rec)
    if (!g) return false
    const next: Settings = {
      ...loadSettings(),
      rule: rec.rule,
      mode: rec.rif ? 'rif' : 'free',
      ...(opts?.player ? { player: opts.player } : {}),
    }
    setSettings(next)
    setMoves(rec.moves)
    setRifMeta(meta)
    setOfferPick([])
    setRifError(null)
    setAiNotes([])
    setResigned(false)
    recordedRef.current = false
    pendingRef.current = ''
    aiOpeningRef.current = null
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
    if (!ongoing || thinking) return
    if (mode === 'rif') {
      if (phase === 'opening') {
        if (tentColor !== BLACK) return
        dispatch({ type: 'place', pos: { x, y } })
        return
      }
      if (phase === 'swap') return
      if (phase === 'offer5') {
        if (playerColor !== BLACK) return
        if (game.board[idx(x, y)] !== EMPTY) return
        setRifError(null)
        setOfferPick((prev) => {
          const i = prev.findIndex((p) => p.x === x && p.y === y)
          if (i >= 0) return prev.filter((_, k) => k !== i)
          if (prev.length >= 2) return prev
          return [...prev, { x, y }]
        })
        return
      }
      if (phase === 'choose5') {
        if (playerColor !== WHITE) return
        const off = rifMeta.offers
        if (off && off.some((p) => p.x === x && p.y === y))
          dispatch({ type: 'choose', pos: { x, y } })
        return
      }
      // move4 / normal
      if (game.toMove !== playerColor || !game.canPlay(x, y)) return
      dispatch({ type: 'place', pos: { x, y } })
      return
    }
    if (game.toMove !== playerColor) return
    if (!game.canPlay(x, y)) return
    setMoves((prev) => [...prev, { x, y }])
  }

  /** 悔到自己上一手後的目標手數（規約模式另設下限：不可悔穿第 5 手成立點）。 */
  const undoTarget = useMemo(() => {
    let n = moves.length
    const myParity = playerColor === BLACK ? 0 : 1
    while (n > 0 && (n - 1) % 2 !== myParity) n--
    if (n > 0) n--
    return n
  }, [moves.length, playerColor])
  const canUndo =
    !thinking &&
    !resigned &&
    moves.length > 0 &&
    (mode !== 'rif' || (phase === 'normal' && undoTarget >= 5))

  /** 悔到自己上一手：先撤掉頂上的 AI 手，再撤自己一手。 */
  const undo = () => {
    if (!canUndo) return
    pendingRef.current = `${gameId}:undo:${moves.length}` // 使在途 AI 結果失效
    setMoves((prev) => prev.slice(0, undoTarget))
  }

  const resign = () => {
    if (!ongoing || moves.length === 0) return
    setResigned(true)
  }

  const confirmOffer = () => {
    if (offerPick.length !== 2) return
    if (dispatch({ type: 'offer', a: offerPick[0], b: offerPick[1] })) setOfferPick([])
  }

  const last = moves[moves.length - 1] ?? null
  const stats = loadStats()[statKey(rule, level)] ?? { win: 0, loss: 0, draw: 0 }

  const seatLabel = playerColor === BLACK ? '黑' : '白'
  const rifStatus = (): string => {
    switch (phase) {
      case 'opening':
        return tentColor === BLACK
          ? `你是暫黑：擺開局第 ${moves.length + 1} 手（1 天元、2 中央3×3、3 中央5×5）`
          : 'AI（暫黑）擺開局中…'
      case 'swap':
        return tentColor === WHITE ? '你是暫白：決定是否換邊' : 'AI（暫白）評估換邊中…'
      case 'move4':
        return game.toMove === playerColor ? '輪到你下第 4 手（任意空點）' : 'AI 思考第 4 手…'
      case 'offer5':
        return playerColor === BLACK
          ? `黑方兩打：點選兩個第 5 手候選（已選 ${offerPick.length}/2）`
          : 'AI（黑）思考兩打…'
      case 'choose5':
        return playerColor === WHITE ? '白方擇打：點 A 或 B 其中一點' : 'AI（白）擇打中…'
      default:
        return game.toMove === playerColor ? '輪到你落子' : '等待 AI'
    }
  }

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
      : mode === 'rif'
        ? rifStatus()
        : game.toMove === playerColor
          ? '輪到你落子'
          : '等待 AI'

  const shareUrl = !ongoing ? `${location.origin}${location.pathname}#/replay/${recordStr}` : null

  const marks =
    mode === 'rif'
      ? phase === 'offer5'
        ? offerPick.map((p, i) => ({ ...p, label: 'AB'[i] }))
        : phase === 'choose5' && rifMeta.offers
          ? rifMeta.offers.map((p, i) => ({ ...p, label: 'AB'[i] }))
          : []
      : []

  const boardDisabled =
    !ongoing ||
    thinking ||
    (mode === 'rif'
      ? phase === 'opening'
        ? tentColor !== BLACK
        : phase === 'swap'
          ? true
          : phase === 'offer5'
            ? playerColor !== BLACK
            : phase === 'choose5'
              ? playerColor !== WHITE
              : game.toMove !== playerColor
      : game.toMove !== playerColor)

  // 兩打棄點（第 5 手成立後）：顯示於規約紀錄。
  const rejected5 =
    rifMeta.offers && moves.length >= 5
      ? rifMeta.offers.find((p) => !(p.x === moves[4].x && p.y === moves[4].y))
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
          marks={marks}
          onCell={onCell}
          disabled={boardDisabled}
        />
        {!ongoing && shareUrl && (
          <div className="endgame-bar">
            <button className="btn primary" onClick={newGame}>
              再來一局
            </button>
            <button className="btn" onClick={() => navigate(`replay/${recordStr}`)}>
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
          對局模式
          <select
            value={mode}
            onChange={(e) => updateSettings({ mode: e.target.value as Settings['mode'] }, true)}
            aria-label="對局模式"
          >
            <option value="free">自由對弈</option>
            <option value="rif">正式規約（RIF）</option>
          </select>
        </label>
        {mode === 'free' ? (
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
        ) : (
          <p className="rif-note">規約固定連珠規則（黑有禁手）。</p>
        )}
        <label>
          先後手
          <select
            value={player}
            onChange={(e) =>
              updateSettings({ player: e.target.value as 'black' | 'white' }, true)
            }
            aria-label="先後手"
          >
            <option value="black">{mode === 'rif' ? '暫黑（擺開局）' : '執黑（先手）'}</option>
            <option value="white">
              {mode === 'rif' ? '暫白（決定換邊）' : '執白（後手）'}
            </option>
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
        {mode === 'rif' && phase === 'swap' && tentColor === WHITE && ongoing && (
          <div className="btn-row">
            <button className="btn primary" onClick={() => dispatch({ type: 'swap', swap: true })}>
              換邊（改執黑）
            </button>
            <button className="btn" onClick={() => dispatch({ type: 'swap', swap: false })}>
              不換邊（續執白）
            </button>
          </div>
        )}
        {mode === 'rif' && phase === 'offer5' && playerColor === BLACK && ongoing && (
          <div className="btn-row">
            <button className="btn primary" onClick={confirmOffer} disabled={offerPick.length !== 2}>
              確定兩打
            </button>
            <button className="btn" onClick={() => setOfferPick([])} disabled={offerPick.length === 0}>
              重選
            </button>
          </div>
        )}
        {rifError && <p className="msg err">{rifError}</p>}
        {mode === 'rif' && (moves.length > 0 || aiNotes.length > 0) && (
          <div className="rif-info">
            {opening && (
              <p>
                開局：<b>{opening.name}</b>（{OPENING_KIND_LABEL[opening.kind]}第 {opening.index} 型）
              </p>
            )}
            {rifMeta.swapped !== null && (
              <p>
                {rifMeta.swapped ? '暫白已換邊' : '暫白不換邊'} → 你執{seatLabel}
              </p>
            )}
            {rifMeta.offers && (
              <p>
                兩打：A {coordName(rifMeta.offers[0])}／B {coordName(rifMeta.offers[1])}
                {moves.length >= 5 && rejected5 && (
                  <>
                    　白擇 <b>{coordName(moves[4])}</b>（棄 {coordName(rejected5)}）
                  </>
                )}
              </p>
            )}
            {aiNotes.map((n, i) => (
              <p key={i} className="rif-note">
                {n}
              </p>
            ))}
          </div>
        )}
        <div className="btn-row">
          <button className="btn" onClick={undo} disabled={!canUndo}>
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
