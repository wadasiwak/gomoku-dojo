// 題庫答題頁：用戶執攻方連續衝四；每手由 judge（引擎即時驗證）判對錯，
// 守方最強應手由引擎代下。判錯 → 撤回可重試＋進錯題本；看解答 → 播主變化。
import { useEffect, useMemo, useRef, useState } from 'react'
import Board from './Board.tsx'
import { Game } from '../engine/game.ts'
import { EngineClient } from '../engine/client.ts'
import { parseRecord } from '../engine/record.ts'
import { BLACK, WHITE, type Color, type Pos } from '../engine/types.ts'
import { judgeAttackerMove, type WrongReason } from '../puzzle/judge.ts'
import { getPuzzle, nextPuzzleId, DIFF_LABEL } from '../puzzles/index.ts'
import { recordPuzzleAttempt } from '../storage.ts'
import { navigate } from '../router.ts'

const WRONG_TEXT: Record<WrongReason, string> = {
  forbidden: '這一點是黑棋禁手，下不得。',
  'not-four': '這一手不是衝四——VCF 每一手都要成四或直接成五。',
  'defender-five': '衝四方向錯了：對方現在有一手成五點，會反殺。',
  'loses-vcf': '這個衝四讓 VCF 斷線了（引擎已證實擋完之後無解）。',
}

export default function PuzzlePlay({ id }: { id: string }) {
  const puzzle = getPuzzle(id)
  const clientRef = useRef<EngineClient | null>(null)
  if (!clientRef.current) clientRef.current = new EngineClient()
  const client = clientRef.current
  useEffect(() => () => clientRef.current?.dispose(), [])

  const [line, setLine] = useState<Pos[]>([]) // 攻守交替的已下著手
  const [judging, setJudging] = useState(false)
  const [solved, setSolved] = useState(false)
  const [missed, setMissed] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [solutionStep, setSolutionStep] = useState<number | null>(null) // null=非解答模式
  const recordedRef = useRef(false)

  const base = useMemo(() => {
    if (!puzzle) return null
    const rec = parseRecord(puzzle.record)
    return rec ? Game.fromRecord(rec) : null
  }, [puzzle])

  // 題目切換時重置。
  useEffect(() => {
    setLine([])
    setSolved(false)
    setMissed(false)
    setMsg(null)
    setSolutionStep(null)
    setJudging(false)
    recordedRef.current = false
  }, [id])

  if (!puzzle || !base) {
    return (
      <div className="page">
        <p>找不到這一題。</p>
        <button className="btn" onClick={() => navigate('puzzles')}>
          回題庫
        </button>
      </div>
    )
  }

  const attacker: Color = puzzle.attacker === 'black' ? BLACK : WHITE
  const shown = solutionStep === null ? line : puzzle.solution.slice(0, solutionStep)
  const game = useMemo(() => {
    const g = new Game(puzzle.rule)
    for (const m of base.moves) g.play(m.x, m.y)
    for (const m of shown) g.play(m.x, m.y)
    return g
  }, [puzzle, base, shown])

  const finish = (how: string) => {
    setSolved(true)
    setMsg({ ok: true, text: `完成！${how}` })
    if (!recordedRef.current) {
      recordedRef.current = true
      recordPuzzleAttempt(puzzle.id, true, missed)
    }
  }

  const markMiss = () => {
    if (!missed) {
      setMissed(true)
      recordPuzzleAttempt(puzzle.id, false, true) // 出錯即進錯題本
    }
  }

  const onCell = async (x: number, y: number) => {
    if (judging || solved || solutionStep !== null) return
    if (game.result.kind !== 'ongoing' || game.toMove !== attacker) return
    if (!game.canPlay(x, y)) return
    setJudging(true)
    setMsg(null)
    try {
      const verdict = await judgeAttackerMove(
        game.board,
        attacker,
        puzzle.rule,
        { x, y },
        (b, c, r) => client.vcf(b, c, r, { maxDepth: 14, timeLimitMs: 8000, maxNodes: 1_000_000 }),
      )
      if (verdict.kind === 'wrong') {
        markMiss()
        setMsg({ ok: false, text: `判錯：${WRONG_TEXT[verdict.reason]}　可重試，或看解答。` })
      } else if (verdict.kind === 'solved') {
        setLine((prev) => [...prev, { x, y }])
        finish(
          verdict.how === 'five'
            ? '成五取勝。'
            : '對方唯一擋點是禁手，擋不了——逼禁手取勝。',
        )
      } else {
        setLine((prev) => [...prev, { x, y }, verdict.reply])
        setMsg({ ok: true, text: '正確！對方已擋，繼續。' })
      }
    } finally {
      setJudging(false)
    }
  }

  /** 重來＝開新一次作答：miss 已在發生當下記錄過，這裡歸零讓
   *  「重來後無錯通關」能累積連對（錯題本 SRS 的本意）。 */
  const retry = () => {
    setLine([])
    setMsg(null)
    setSolutionStep(null)
    setSolved(false)
    setMissed(false)
    recordedRef.current = false
  }

  const showSolution = () => {
    markMiss() // 看解答視同出錯，進錯題本
    setSolutionStep(puzzle.solution.length)
    setMsg({ ok: true, text: '主變化如下（可逐步前後）。' })
  }

  const nextId = nextPuzzleId(puzzle.id)
  const last = shown.length > 0 ? shown[shown.length - 1] : null
  const inSolution = solutionStep !== null

  return (
    <div className="page play-page">
      <div className="board-col">
        <p className="status">
          <b>
            {puzzle.attacker === 'black' ? '黑先' : '白先'}——連續衝四取勝（VCF{' '}
            {puzzle.vcfDepth} 手）
          </b>
          <span className="muted">
            　{DIFF_LABEL[puzzle.difficulty]}／
            {puzzle.rule === 'renju' ? '連珠' : '無禁手'}／{puzzle.id}
          </span>
        </p>
        <Board
          board={game.board}
          lastMove={last}
          numbered={inSolution ? puzzle.solution.slice(0, solutionStep ?? 0) : undefined}
          onCell={onCell}
          disabled={judging || solved || inSolution}
        />
        {msg && (
          <p className={`msg ${msg.ok ? 'ok' : 'err'}`} role="status">
            {msg.text}
          </p>
        )}
        {judging && <p className="muted small">引擎驗證中…</p>}
      </div>
      <aside className="panel">
        <h2>題目資訊</h2>
        <p className="muted small">
          規則：{puzzle.rule === 'renju' ? '連珠（黑有禁手）' : '無禁手五子棋'}
          <br />
          {puzzle.attacker === 'black' ? '黑' : '白'}先，最短 {puzzle.vcfDepth} 手 VCF
          （引擎已證明）。每一手都會由引擎即時驗證——走出另一條同樣成立的 VCF
          也算對。
        </p>
        {inSolution && (
          <div className="btn-row">
            <button
              className="btn"
              onClick={() => setSolutionStep((s) => Math.max(0, (s ?? 0) - 1))}
              disabled={(solutionStep ?? 0) <= 0}
            >
              ◀ 上一步
            </button>
            <button
              className="btn"
              onClick={() =>
                setSolutionStep((s) => Math.min(puzzle.solution.length, (s ?? 0) + 1))
              }
              disabled={(solutionStep ?? 0) >= puzzle.solution.length}
            >
              下一步 ▶
            </button>
          </div>
        )}
        <div className="btn-row">
          <button className="btn" onClick={retry}>
            重來
          </button>
          {!inSolution && (
            <button className="btn" onClick={showSolution} disabled={solved}>
              看解答
            </button>
          )}
          {inSolution && (
            <button className="btn" onClick={retry}>
              回到答題
            </button>
          )}
        </div>
        <div className="btn-row">
          {solved && nextId && (
            <button className="btn primary" onClick={() => navigate(`puzzle/${nextId}`)}>
              下一題
            </button>
          )}
          <button className="btn" onClick={() => navigate('puzzles')}>
            回題庫
          </button>
        </div>
      </aside>
    </div>
  )
}
