// Rapfi 分析面板：擺譜／研棋的「第二意見」（對弈預設仍是本站原創引擎）。
// - 首次點擊才懶載入引擎（glue＋wasm＋40MB NNUE 權重，之後走瀏覽器快取），
//   載入中顯示進度條並明示 40MB 首載。
// - 不支援 wasm SIMD 的瀏覽器整塊隱藏（降級；本站引擎的 AI 建議照常可用）。
// - 局面變更（positionKey）→ 作廢顯示中的結果與在途分析（不 terminate，
//   RapfiClient.analyze 內部佇列會自行消化）；「取消」才 stop()——單執行緒
//   build 思考中收不到停止指令，只能 terminate worker，下次分析重新初始化
//   （artifacts 走 HTTP cache，秒級）。
// - 建議手經 onMove 回拋給父層畫 hint 圈；PV／評分／勝率在面板內文字顯示。
import { useEffect, useRef, useState } from 'react'
import {
  getRapfi,
  isRapfiSupported,
  type RapfiAnalysis,
  type RapfiInput,
  type RapfiLoadProgress,
} from '../analysis/rapfi.ts'
import type { Pos, Rule } from '../engine/types.ts'
import { coordName } from './coords.ts'

interface Props {
  /** 取當前局面（點擊分析當下才呼叫）。 */
  buildInput: () => RapfiInput
  rule: Rule
  /** 局面簽名：變更即作廢顯示中的結果與在途分析。 */
  positionKey: string
  /** 待思考方標籤（「黑」／「白」）。 */
  toMoveLabel: string
  disabled?: boolean
  /** 建議手回拋（父層畫 hint 圈）。 */
  onMove: (p: Pos | null) => void
}

type Phase = 'idle' | 'loading' | 'thinking'

export default function RapfiPanel({
  buildInput,
  rule,
  positionKey,
  toMoveLabel,
  disabled,
  onMove,
}: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [thinkMs, setThinkMs] = useState(3000)
  const [progress, setProgress] = useState<RapfiLoadProgress | null>(null)
  const [result, setResult] = useState<RapfiAnalysis | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [everLoaded, setEverLoaded] = useState(false)
  const seqRef = useRef(0)

  // 局面變了：作廢在途分析與舊結果（引擎讓它想完，analyze 佇列會消化）。
  useEffect(() => {
    seqRef.current++
    setResult(null)
    setError(null)
    setPhase('idle')
    setProgress(null)
  }, [positionKey])

  // unmount：作廢在途回呼（worker 留給全站單例，不 terminate）。
  useEffect(
    () => () => {
      seqRef.current++
    },
    [],
  )

  if (!isRapfiSupported()) return null

  const analyze = async () => {
    if (disabled || phase !== 'idle') return
    const my = ++seqRef.current
    setError(null)
    setResult(null)
    onMove(null)
    const rapfi = getRapfi()
    try {
      setPhase('loading')
      await rapfi.preload((p) => {
        if (seqRef.current === my) setProgress(p)
      })
      if (seqRef.current !== my) return
      setEverLoaded(true)
      setPhase('thinking')
      const a = await rapfi.analyze(buildInput(), rule, thinkMs)
      if (seqRef.current !== my) return
      setResult(a)
      onMove(a.move)
      setPhase('idle')
    } catch (e) {
      if (seqRef.current !== my) return
      setError(e instanceof Error ? e.message : String(e))
      setPhase('idle')
      setProgress(null)
    }
  }

  const cancel = () => {
    seqRef.current++
    getRapfi().stop()
    setPhase('idle')
    setProgress(null)
  }

  const pct = progress ? Math.round(progress.progress * 100) : 0

  return (
    <div className="rapfi-box">
      <h2>Rapfi 分析</h2>
      <p className="muted small">
        Gomocup 冠軍級引擎的第二意見（NNUE 評估）。
        {!everLoaded && '首次使用需下載約 40MB 引擎資料，之後走瀏覽器快取。'}
      </p>
      <div className="btn-row">
        <button
          className="btn"
          onClick={analyze}
          disabled={disabled || phase !== 'idle'}
        >
          {phase === 'loading'
            ? '載入引擎…'
            : phase === 'thinking'
              ? 'Rapfi 思考中…'
              : 'Rapfi 分析'}
        </button>
        <select
          value={thinkMs}
          onChange={(e) => setThinkMs(Number(e.target.value))}
          aria-label="Rapfi 思考時間"
        >
          <option value={1000}>想 1 秒</option>
          <option value={3000}>想 3 秒</option>
          <option value={10000}>想 10 秒</option>
        </select>
        {phase !== 'idle' && (
          <button className="btn" onClick={cancel}>
            取消
          </button>
        )}
      </div>
      {phase === 'loading' && (
        <div className="rapfi-load">
          <div
            className="progress"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <i style={{ width: `${pct}%` }} />
          </div>
          <p className="muted small">下載引擎資料 {pct}%（首次約 40MB，之後走快取）</p>
        </div>
      )}
      {error && <p className="msg err">Rapfi 分析失敗：{error}</p>}
      {result && (
        <div className="rapfi-result msg ok">
          <p>
            Rapfi 建議：<b>{coordName(result.move)}</b>（{toMoveLabel}）
            {result.evalText !== undefined && <>　評分 <b>{result.evalText}</b></>}
            {result.winrate !== undefined &&
              `　勝率 ${(result.winrate * 100).toFixed(1)}%`}
            {result.depth !== undefined && `　深度 ${result.depth}`}
          </p>
          {result.pv.length > 1 && (
            <p className="rapfi-pv">主變化：{result.pv.map(coordName).join(' → ')}</p>
          )}
          <p className="rapfi-ms muted">實際思考 {(result.timeMs / 1000).toFixed(1)}s</p>
        </div>
      )}
    </div>
  )
}
