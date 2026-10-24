// 名人賽特訓頁（#/tara）：塔拉山口-10 開局規則 vs Rapfi，可計時。
//
// 規則狀態＝tara/protocol.ts 純函式 reducer（moves 單一真相＋meta 事件）；
// 勝負由 Game 重放判定（與對弈頁同手法）。AI 的開局決策在 tara/ai.ts
// （Rapfi 當評估器），正常輪替後直接用 Rapfi 出手（強度＝深度上限）。
//
// 誰該行動：actorColor(state) 給「顏色」，再對照雙方目前執色（交換會互換）
// 決定是人還是 AI。AI 手番觸發用 pendingRef key 防 StrictMode 雙效應；
// 重開/悔棋改 key，在途的 Rapfi 結果作廢（多步掃描在進度回呼裡丟 Cancelled
// 提早收手，不 terminate worker——單執行緒引擎重載要好幾秒）。
//
// 棋鐘（加秒制）：時間跑在「目前該行動的一方」，含開局的交換/選擇階段；
// 每次輪到對方時，剛交棒的一方加秒。人方用完判超時負；AI 每手用時由
// moveBudgetMs 分配，不會超時。
import { useEffect, useMemo, useRef, useState } from 'react'
import Board from './Board.tsx'
import { coordName } from './coords.ts'
import { Game } from '../engine/game.ts'
import { EngineClient } from '../engine/client.ts'
import { serializeRecord } from '../engine/record.ts'
import { BLACK, opponent, type Color, type Pos } from '../engine/types.ts'
import {
  taraInitial,
  taraReduce,
  taraPhase,
  actorColor,
  firstPlayerColor,
  areaLimit,
  areaSize,
  offerEquivalentTo,
  TARA_OFFER_COUNT,
  type TaraAction,
  type TaraState,
} from '../tara/protocol.ts'
import {
  aiPlaceBalanced,
  aiSwap,
  aiTenPlan,
  decideBranch,
  aiChooseOffer,
  type TenPlan,
} from '../tara/ai.ts'
import {
  rapfiOracle,
  RAPFI_STRENGTHS,
  TIME_CONTROLS,
  UNTIMED_MOVE_MS,
  moveBudgetMs,
  posEq,
} from '../tara/oracle.ts'
import { getRapfi, isRapfiSupported, multiThreadDisabledByCrashGuard } from '../analysis/rapfi.ts'
import {
  loadTaraSettings,
  saveTaraSettings,
  recordOutcomeByKey,
  taraStatKey,
  loadStats,
  saveGame,
  type TaraSettings,
} from '../storage.ts'
import { navigate } from '../router.ts'
import { t, useT } from '../i18n/index.ts'

const KIND_LABEL: Record<string, string> = {
  overline: '長連',
  'double-four': '四四',
  'double-three': '三三',
}

/** 掃描途中發現局面已作廢（重開/悔棋）→ 丟這個中止後續 Rapfi 呼叫。 */
class Cancelled extends Error {}

interface Note {
  text: string
  /** 評估分數說明（黑方視角）；「對局中顯示 AI 評分」關閉時終局才顯示。 */
  score?: string
}

const fmtBlack = (v: number | null | undefined): string | undefined => {
  if (v === null || v === undefined) return undefined
  if (Math.abs(v) > 20000) return v > 0 ? t('黑方必勝') : t('白方必勝')
  return t('黑方 {v}', { v: `${v > 0 ? '+' : ''}${Math.round(v)}` })
}

const fmtClock = (ms: number): string => {
  const t = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(t / 60)
  const s = t % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

type Who = 'human' | 'ai'

export default function TaraPlay() {
  const t = useT()
  const clientRef = useRef<EngineClient | null>(null)
  if (!clientRef.current) clientRef.current = new EngineClient()
  const client = clientRef.current
  useEffect(() => () => clientRef.current?.dispose(), [])

  const [cfg, setCfg] = useState<TaraSettings>(loadTaraSettings)
  const [st, setSt] = useState<TaraState>(() => taraInitial())
  const [gameId, setGameId] = useState(1)
  const [resigned, setResigned] = useState(false)
  const [flagged, setFlagged] = useState(false)
  const [thinking, setThinking] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [rapfiLoad, setRapfiLoad] = useState<number | null>(null)
  const [notes, setNotes] = useState<Note[]>([])
  const [offerPick, setOfferPick] = useState<Pos[]>([])
  const [error, setError] = useState<string | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState<{ index: number; kind: string }[]>([])
  const [, setStatsBump] = useState(0)
  const pendingRef = useRef('')
  /** 十打計畫快取：分支決定時算好，擺十打時直接用（同一局面）。 */
  const planRef = useRef<{ key: string; plan: TenPlan } | null>(null)
  const recordedRef = useRef(false)

  const tc = TIME_CONTROLS[cfg.timeControl]
  const [clock, setClock] = useState({ human: tc?.baseMs ?? 0, ai: tc?.baseMs ?? 0 })
  const runRef = useRef<{ who: Who | null; since: number }>({ who: null, since: 0 })
  const [now, setNow] = useState(() => Date.now())

  const phase = taraPhase(st)
  const firstColor = firstPlayerColor(st.meta)
  const humanColor: Color = cfg.seat === 'first' ? firstColor : opponent(firstColor)
  const aiColor = opponent(humanColor)
  const actor = actorColor(st)
  const actorWho: Who = actor === humanColor ? 'human' : 'ai'

  const game = useMemo(() => {
    const g = new Game('renju')
    for (const m of st.moves) g.play(m.x, m.y)
    return g
  }, [st.moves])

  const ended = resigned || flagged || game.result.kind !== 'ongoing'
  const ongoing = !ended
  /** 勝方與終局原因（顯示/存檔用）。 */
  const outcome: { winner: Color | null; reason: string } | null = !ended
    ? null
    : flagged
      ? { winner: aiColor, reason: 'time' }
      : resigned
        ? { winner: aiColor, reason: 'resign' }
        : game.result.kind === 'draw'
          ? { winner: null, reason: 'draw' }
          : game.result.kind === 'win'
            ? { winner: game.result.winner, reason: game.result.reason }
            : null

  const act = (a: TaraAction): boolean => {
    const { next, error: e } = taraReduce(st, a)
    if (e) {
      setError(e)
      return false
    }
    setError(null)
    setSt(next)
    return true
  }

  const updateCfg = (patch: Partial<TaraSettings>, restart: boolean) => {
    const next = { ...cfg, ...patch }
    setCfg(next)
    saveTaraSettings(next)
    if (restart) newGame(next)
  }

  const newGame = (c: TaraSettings = cfg) => {
    pendingRef.current = ''
    planRef.current = null
    recordedRef.current = false
    runRef.current = { who: null, since: 0 }
    const base = TIME_CONTROLS[c.timeControl]?.baseMs ?? 0
    setClock({ human: base, ai: base })
    setSt(taraInitial())
    setResigned(false)
    setFlagged(false)
    setThinking(false)
    setProgress(null)
    setRapfiLoad(null)
    setNotes([])
    setOfferPick([])
    setError(null)
    setAiError(null)
    setGameId((n) => n + 1)
  }

  /** extra＝附加的評估說明，與 score 一起受「顯示 AI 評分」開關控制。 */
  const note = (text: string, score?: number | null, extra?: string) =>
    setNotes((n) => [
      ...n,
      { text, score: [fmtBlack(score), extra].filter(Boolean).join('；') || undefined },
    ])

  // e2e 測試 hook：直接載入某個規則狀態（驗人方擺十打等需要特定執色的路徑）。
  useEffect(() => {
    window.__dojo = {
      ...window.__dojo,
      loadTara: (state: TaraState) => {
        newGame()
        setSt(state)
      },
    }
    return () => {
      if (window.__dojo) delete window.__dojo.loadTara
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- 棋鐘 ---------------------------------------------------------------
  // 行動方切換時：把上一位的用時扣掉並加秒，再開始計新行動方。
  useEffect(() => {
    if (!tc) return
    const run = runRef.current
    const t = Date.now()
    const next: Who | null = ongoing ? actorWho : null
    if (run.who === next) return
    if (run.who) {
      const prev = run.who
      const used = t - run.since
      setClock((c) => ({ ...c, [prev]: c[prev] - used + (next ? tc.incMs : 0) }))
    }
    runRef.current = { who: next, since: t }
  }, [tc, ongoing, actorWho, gameId])

  // 走秒（只為了重繪與判超時）。
  useEffect(() => {
    if (!tc || !ongoing) return
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [tc, ongoing])

  // now 是上次走秒重繪的時間戳，可能早於計時起點 → 經過時間夾在 0 以上
  const remaining = (who: Who): number =>
    clock[who] - (runRef.current.who === who ? Math.max(0, now - runRef.current.since) : 0)

  useEffect(() => {
    if (tc && ongoing && runRef.current.who === 'human' && remaining('human') <= 0) {
      pendingRef.current = `${gameId}:flag`
      setFlagged(true)
    }
  })

  // ---- AI 手番 --------------------------------------------------------------
  useEffect(() => {
    if (!ongoing || actorWho !== 'ai') return
    if (!isRapfiSupported()) {
      setAiError(t('這個瀏覽器不支援 WebAssembly SIMD，無法載入 Rapfi。請改用新版 Chrome／Safari／Firefox。'))
      return
    }
    const key = `${gameId}:${phase}:${st.moves.length}:${st.meta.swaps.length}:${st.meta.branch}:${st.meta.offers ? 1 : 0}`
    if (pendingRef.current === key) return
    pendingRef.current = key
    const alive = () => pendingRef.current === key
    const guard = (label: string) => (done: number, total: number, stage?: string) => {
      if (!alive()) throw new Cancelled()
      setProgress(`${stage === 'tenGuard' ? t('AI 檢查白 4 會不會被十打') : label} ${done}/${total}`)
    }
    setThinking(true)
    setAiError(null)

    const run = async () => {
      await getRapfi().preload((p) => {
        if (alive()) setRapfiLoad(Math.round(p.progress * 100))
      })
      if (!alive()) return
      setRapfiLoad(null)
      const oracle = rapfiOracle()
      const s = st
      const n = s.moves.length

      if (phase === 'place') {
        // 開局擺子（第 1～4 手、塔拉分支第 5 手）：下完對方可交換 → 取最均衡點。
        // 白 4 另外防十打（ai.ts guardWhite4），進度列會多一段「檢查十打」。
        const r = await aiPlaceBalanced(s, oracle, Math.random, guard(t('AI 評估候選')))
        if (!alive()) return
        if (act({ type: 'place', pos: r.move }))
          note(
            n === 0
              ? t('AI 下第 1 手：天元 H8')
              : n === 3
                ? t('AI 下白 4 {pos}（取均衡點並防十打）', { pos: coordName(r.move) })
                : t('AI 下第 {n} 手 {pos}（取最均衡點）', { n: n + 1, pos: coordName(r.move) }),
            r.black,
            r.tenValue != null ? t('對方十打值 {v}', { v: fmtBlack(r.tenValue)! }) : undefined,
          )
        return
      }
      if (phase === 'normal') {
        const budget = tc ? moveBudgetMs(remaining('ai'), tc.incMs) : UNTIMED_MOVE_MS
        const r = await getRapfi().analyze(
          { moves: s.moves },
          'renju',
          budget,
          RAPFI_STRENGTHS[cfg.strength].limits,
        )
        if (!alive()) return
        act({ type: 'place', pos: r.move })
        return
      }
      if (phase === 'swap') {
        const r = await aiSwap(s, aiColor, oracle)
        if (!alive()) return
        if (act({ type: 'swap', swap: r.swap }))
          note(r.swap ? t('AI 選擇交換（雙方互換執色）') : t('AI 不交換'), r.black)
        return
      }
      if (phase === 'branch') {
        setProgress(t('AI 計算十打值（多 PV）…'))
        const plan = await aiTenPlan(s, oracle)
        if (!alive()) return
        planRef.current = { key: `${gameId}:${s.moves.length}:${s.meta.swaps.length}`, plan }
        const choice = decideBranch(plan)
        if (act({ type: 'branch', choice }))
          note(
            choice === 'ten'
              ? t('AI 選①十打：持黑擺 10 個第 5 手')
              : t('AI 選③持白（十打不利）：由你下黑 5，AI 最後選黑白'),
            plan.value,
          )
        return
      }
      if (phase === 'offer10') {
        const cached = planRef.current
        const plan =
          cached && cached.key === `${gameId}:${s.moves.length}:${s.meta.swaps.length}`
            ? cached.plan
            : await aiTenPlan(s, oracle)
        if (!alive()) return
        if (act({ type: 'offer', offers: plan.offers }))
          note(t('AI 十打：{list}', { list: plan.offers.map(coordName).join(t('、')) }), plan.value)
        return
      }
      if (phase === 'choose10') {
        const r = await aiChooseOffer(s, oracle, guard(t('AI 評估十打')))
        if (!alive()) return
        if (act({ type: 'choose', pos: r.move }))
          note(t('AI 從十打中擇 {pos}（對黑最不利的一點）', { pos: coordName(r.move) }), r.black)
        return
      }
    }

    run()
      .catch((e) => {
        if (e instanceof Cancelled || !alive()) return
        setAiError(t('AI 出錯：{msg}。可按「重開」再試。', { msg: e instanceof Error ? e.message : String(e) }))
      })
      .finally(() => {
        if (alive()) {
          setThinking(false)
          setProgress(null)
          setRapfiLoad(null)
        }
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ongoing, actorWho, phase, st, gameId])

  // ---- 黑禁手點（我執黑、正常輪替、輪到黑） -------------------------------
  useEffect(() => {
    let cancelled = false
    if (cfg.showForbidden && ongoing && phase === 'normal' && game.toMove === BLACK) {
      client.forbiddenPoints(game.board).then((pts) => {
        if (!cancelled) setForbidden(pts)
      })
    } else setForbidden([])
    return () => {
      cancelled = true
    }
  }, [client, cfg.showForbidden, ongoing, phase, game])

  // ---- 終局：記戰績＋存棋譜庫（每局一次） ---------------------------------
  const recordStr = serializeRecord({ rule: 'renju', moves: st.moves })
  useEffect(() => {
    if (!outcome || recordedRef.current || st.moves.length === 0) return
    recordedRef.current = true
    const res = outcome.winner === null ? 'draw' : outcome.winner === humanColor ? 'win' : 'loss'
    recordOutcomeByKey(taraStatKey(cfg.strength), res)
    saveGame({
      rule: 'renju',
      level: 5,
      player: humanColor === BLACK ? 'black' : 'white',
      outcome: res,
      reason: outcome.reason,
      record: recordStr,
      mode: 'tara',
      strength: RAPFI_STRENGTHS[cfg.strength].label,
    })
    setStatsBump((x) => x + 1)
  })

  // ---- 人方操作 -------------------------------------------------------------
  const humanTurn = ongoing && !thinking && actorWho === 'human'

  const onCell = (x: number, y: number) => {
    if (!humanTurn) return
    const p = { x, y }
    if (phase === 'place' || phase === 'normal') {
      act({ type: 'place', pos: p })
      return
    }
    if (phase === 'offer10') {
      if (st.moves.some((m) => posEq(m, p))) return
      const i = offerPick.findIndex((q) => posEq(q, p))
      if (i >= 0) {
        setOfferPick(offerPick.filter((_, k) => k !== i))
        setError(null)
        return
      }
      if (offerPick.length >= TARA_OFFER_COUNT) {
        setError(t('已選滿 {n} 個，點已選的點可取消', { n: TARA_OFFER_COUNT }))
        return
      }
      const eq = offerEquivalentTo(st.moves, offerPick, p)
      if (eq) {
        setError(t('{a} 與已選的 {b} 對稱等價（白方挑起來是同一局面），換一點', { a: coordName(p), b: coordName(eq) }))
        return
      }
      setError(null)
      setOfferPick([...offerPick, p])
      return
    }
    if (phase === 'choose10') {
      if (st.meta.offers!.some((q) => posEq(q, p))) act({ type: 'choose', pos: p })
    }
  }

  // 悔棋：只在開局結束後、悔到自己上一手（AI 那手一起撤），不可悔進開局階段。
  const OPENING_LEN = 5
  const undoTarget = useMemo(() => {
    let n = st.moves.length
    const myParity = humanColor === BLACK ? 0 : 1
    while (n > 0 && (n - 1) % 2 !== myParity) n--
    if (n > 0) n--
    return n
  }, [st.moves.length, humanColor])
  const canUndo = phase === 'normal' && !thinking && !resigned && !flagged && undoTarget >= OPENING_LEN
  const undo = () => {
    if (!canUndo) return
    pendingRef.current = `${gameId}:undo:${st.moves.length}`
    setSt({ ...st, moves: st.moves.slice(0, undoTarget) })
  }

  // ---- 顯示 ---------------------------------------------------------------
  const colorName = (c: Color) => (c === BLACK ? t('黑') : t('白'))
  const n = st.moves.length
  const limit = areaLimit(st, n + 1)

  const statusText = (): string => {
    if (outcome) {
      const reason: Record<string, string> = {
        five: t('五連'),
        overline: t('長連'),
        forbidden: t('黑踩禁手'),
        resign: t('認輸'),
        time: t('超時'),
        draw: t('和局'),
      }
      if (outcome.winner === null) return t('和局')
      return t('{who}（{reason}）', {
        who: outcome.winner === humanColor ? t('你獲勝') : t('Rapfi 獲勝'),
        reason: reason[outcome.reason] ?? outcome.reason,
      })
    }
    if (thinking)
      return rapfiLoad !== null
        ? t('載入 Rapfi 中… {p}%（首次約 40MB，之後走快取）', { p: rapfiLoad })
        : (progress ?? t('Rapfi 思考中…'))
    if (actorWho === 'ai') return t('等待 Rapfi')
    switch (phase) {
      case 'place':
        return limit === null
          ? t('輪到你下第 {n} 手', { n: n + 1 })
          : limit === 0
            ? t('輪到你下第 1 手：天元（H8）')
            : t('輪到你下第 {n} 手：中央 {k}×{k} 內', { n: n + 1, k: areaSize(limit) })
      case 'swap':
        return n === 5
          ? t('黑 5 已下：你最後選黑白（目前你執{c}）', { c: colorName(humanColor) })
          : t('你決定是否交換（目前你執{c}）', { c: colorName(humanColor) })
      case 'branch':
        return t('白 4 已下：你三選一（十打／持黑／持白）')
      case 'offer10':
        return t('十打：點選 {n} 個第 5 手候選（已選 {k}/{n}）', { n: TARA_OFFER_COUNT, k: offerPick.length })
      case 'choose10':
        return t('從黑方的十個候選中點選一個當第 5 手')
      default:
        return t('輪到你落子')
    }
  }

  const marks =
    phase === 'offer10' && actorWho === 'human'
      ? offerPick.map((p, i) => ({ ...p, label: String(i + 1) }))
      : phase === 'choose10' && st.meta.offers
        ? st.meta.offers.map((p, i) => ({ ...p, label: String(i + 1) }))
        : []

  const stats = loadStats()[taraStatKey(cfg.strength)] ?? { win: 0, loss: 0, draw: 0 }
  const showScores = cfg.showEval || !ongoing
  const last = st.moves[n - 1] ?? null
  const rejected =
    st.meta.offers && n >= 5 ? st.meta.offers.filter((p) => !posEq(p, st.moves[4])) : []

  return (
    <div className="page play-page tara-page">
      <div className="board-col">
        <p className={`status${thinking ? ' thinking' : ''}${!ongoing ? ' final' : ''}`}>
          <b>{statusText()}</b>
          <span className="muted">　{t('第 {n} 手', { n })}</span>
          {forbidden.length > 0 && <span className="fb-note">　✕ {t('黑禁手點')}</span>}
        </p>
        {tc && (
          <div className="clock-row" aria-label={t('棋鐘')}>
            <span className={`clock${runRef.current.who === 'human' ? ' running' : ''}${remaining('human') < 60_000 ? ' low' : ''}`}>
              {t('你（{c}）', { c: colorName(humanColor) })}<b>{fmtClock(remaining('human'))}</b>
            </span>
            <span className={`clock${runRef.current.who === 'ai' ? ' running' : ''}`}>
              {t('Rapfi（{c}）', { c: colorName(aiColor) })}<b>{fmtClock(remaining('ai'))}</b>
            </span>
          </div>
        )}
        <Board
          board={game.board}
          lastMove={last}
          forbidden={forbidden.map((f) => ({
            x: f.index % 15,
            y: Math.floor(f.index / 15),
            kind: KIND_LABEL[f.kind] ? t(KIND_LABEL[f.kind]) : f.kind,
          }))}
          marks={marks}
          onCell={onCell}
          disabled={!humanTurn || phase === 'swap' || phase === 'branch'}
        />
        {/* 開局決策（交換／三選一／十打確定）緊貼棋盤下方：手機不必捲到側欄。 */}
        {humanTurn && phase === 'swap' && (
          <div className="btn-row board-actions">
            <button className="btn primary" onClick={() => act({ type: 'swap', swap: true })}>
              {n === 5
                ? t('我選執{c}', { c: colorName(aiColor) })
                : t('交換（改執{c}）', { c: colorName(aiColor) })}
            </button>
            <button className="btn" onClick={() => act({ type: 'swap', swap: false })}>
              {n === 5 ? t('我選執{c}', { c: colorName(humanColor) }) : t('不交換')}
            </button>
          </div>
        )}
        {humanTurn && phase === 'branch' && (
          <div className="btn-col board-actions">
            <button className="btn primary" onClick={() => act({ type: 'branch', choice: 'ten' })}>
              {t('① 十打：持黑擺 10 個第 5 手，對方挑一')}
            </button>
            <button className="btn" onClick={() => act({ type: 'branch', choice: 'black' })}>
              {t('② 持黑：我下黑 5，對方最後選黑白')}
            </button>
            <button className="btn" onClick={() => act({ type: 'branch', choice: 'white' })}>
              {t('③ 持白：對方下黑 5，我最後選黑白')}
            </button>
          </div>
        )}
        {humanTurn && phase === 'offer10' && (
          <div className="btn-row board-actions">
            <button
              className="btn primary"
              disabled={offerPick.length !== TARA_OFFER_COUNT}
              onClick={() => {
                if (act({ type: 'offer', offers: offerPick })) setOfferPick([])
              }}
            >
              {t('確定十打（{k}/{n}）', { k: offerPick.length, n: TARA_OFFER_COUNT })}
            </button>
            <button className="btn" disabled={offerPick.length === 0} onClick={() => setOfferPick([])}>
              {t('重選')}
            </button>
          </div>
        )}
        {error && <p className="msg err">{error}</p>}
        {aiError && <p className="msg err">{aiError}</p>}
        {!ongoing && (
          <div className="endgame-bar">
            <button className="btn primary" onClick={() => newGame()}>
              {t('再來一局')}
            </button>
            <button className="btn" onClick={() => navigate(`replay/${recordStr}`)}>
              {t('重播＋Rapfi 分析')}
            </button>
            <span className="muted small">{t('已自動存入棋譜庫')}</span>
          </div>
        )}
        <div className="btn-row board-controls">
          <button className="btn" onClick={undo} disabled={!canUndo}>
            {t('悔棋')}
          </button>
          <button
            className="btn"
            onClick={() => {
              pendingRef.current = `${gameId}:resign`
              setResigned(true)
            }}
            disabled={!ongoing || n === 0}
          >
            {t('認輸')}
          </button>
          <button className="btn" onClick={() => newGame()}>
            {t('重開')}
          </button>
        </div>
      </div>
      <aside className="panel">
        <h2>{t('名人賽特訓')}</h2>
        <p className="rif-note">
          {t('塔拉山口-10 開局，對手 Rapfi（Gomocup 冠軍級引擎）。開局決策（擺子／交換／十打）都由 Rapfi 評估。')}
          {getRapfi().threads > 1
            ? t('（多執行緒：{n} 緒）', { n: getRapfi().threads })
            : multiThreadDisabledByCrashGuard()
              ? t('（單執行緒：上次多執行緒引擎在思考中中斷，本分頁改用穩定版；關掉分頁重開即恢復）')
              : ''}
        </p>
        {(notes.length > 0 || rejected.length > 0) && (
          <div className="rif-info">
            {st.meta.offers && n >= 5 && (
              <p>
                {t('十打：第 5 手')} <b>{coordName(st.moves[4])}</b>
                {t('（其餘 {list}）', { list: rejected.map(coordName).join(t('、')) })}
              </p>
            )}
            {notes.map((x, i) => (
              <p key={i} className="rif-note">
                {x.text}
                {showScores && x.score ? `｜${x.score}` : ''}
              </p>
            ))}
          </div>
        )}

        <h2>{t('設定（變更會重開）')}</h2>
        <label>
          {t('先後')}
          <select
            value={cfg.seat}
            onChange={(e) => updateCfg({ seat: e.target.value as TaraSettings['seat'] }, true)}
            aria-label={t('先後')}
          >
            <option value="first">{t('我下第 1 手（暫執黑）')}</option>
            <option value="second">{t('Rapfi 下第 1 手（我暫執白）')}</option>
          </select>
        </label>
        <label>
          {t('Rapfi 強度（開局後）')}
          <select
            value={cfg.strength}
            onChange={(e) => updateCfg({ strength: e.target.value as TaraSettings['strength'] }, false)}
            aria-label={t('Rapfi 強度')}
          >
            {Object.entries(RAPFI_STRENGTHS).map(([k, v]) => (
              <option key={k} value={k}>
                {t(v.label)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('時制')}
          <select
            value={cfg.timeControl}
            onChange={(e) => updateCfg({ timeControl: e.target.value as TaraSettings['timeControl'] }, true)}
            aria-label={t('時制')}
          >
            <option value="none">{t('不計時（Rapfi 每手 5 秒）')}</option>
            {Object.entries(TIME_CONTROLS)
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <option key={k} value={k}>
                  {t(v!.label)}
                </option>
              ))}
          </select>
        </label>
        <label className="row">
          <input
            type="checkbox"
            checked={cfg.showForbidden}
            onChange={(e) => updateCfg({ showForbidden: e.target.checked }, false)}
          />
          {t('顯示黑禁手點 ✕')}
        </label>
        <label className="row">
          <input
            type="checkbox"
            checked={cfg.showEval}
            onChange={(e) => updateCfg({ showEval: e.target.checked }, false)}
          />
          {t('對局中顯示 AI 評分（關閉＝終局才顯示）')}
        </label>
        <h2>{t('本強度戰績')}</h2>
        <p className="stats-line" data-stats={taraStatKey(cfg.strength)}>
          {t('勝')} <b>{stats.win}</b>　{t('敗')} <b>{stats.loss}</b>　{t('和')} <b>{stats.draw}</b>
        </p>
      </aside>
    </div>
  )
}
