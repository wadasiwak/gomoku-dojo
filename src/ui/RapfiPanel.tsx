// Rapfi 分析面板：擺譜／研棋的「第二意見」（對弈預設仍是本站原創引擎）。
// - 首次點擊才懶載入引擎（glue＋wasm＋40MB NNUE 權重，之後走瀏覽器快取），
//   載入中顯示進度條並明示 40MB 首載。
// - 不支援 wasm SIMD 的瀏覽器整塊隱藏（降級；本站引擎的 AI 建議照常可用）。
// - 局面變更（positionKey）→ 作廢顯示中的結果與在途分析（不 terminate，
//   RapfiClient.analyze 內部佇列會自行消化）；「取消」才 stop()——單執行緒
//   build 思考中收不到停止指令，只能 terminate worker，下次分析重新初始化
//   （artifacts 走 HTTP cache，秒級）。
// - 分析結果經 onResult 回拋給父層（畫建議路線，見 pvFollow.ts）；評分／勝率在面板內文字顯示。
//   父層跟著路線走時會維持同一個 positionKey，結果就不會被清掉。
import { useEffect, useRef, useState } from 'react'
import {
  getRapfi,
  isRapfiSupported,
  type RapfiAnalysis,
  type RapfiInput,
  type RapfiLoadProgress,
} from '../analysis/rapfi.ts'
import type { Rule } from '../engine/types.ts'
import { coordName } from './coords.ts'
import { loadRapfiThink, saveRapfiThink } from '../storage.ts'

interface Props {
  /** 取當前局面（點擊分析當下才呼叫）。 */
  buildInput: () => RapfiInput
  rule: Rule
  /** 局面簽名：變更即作廢顯示中的結果與在途分析。 */
  positionKey: string
  /** 待思考方標籤（「黑」／「白」）。 */
  toMoveLabel: string
  disabled?: boolean
  /** 分析結果回拋（父層畫建議路線）；開始新分析時回拋 null。 */
  onResult: (a: RapfiAnalysis | null) => void
  /** 棋盤上建議路線顯示幾手（0＝全部）；選單在本面板、狀態由父層持有。 */
  pvShow: number
  onPvShow: (n: number) => void
}

type Phase = 'idle' | 'loading' | 'thinking'

export default function RapfiPanel({
  buildInput,
  rule,
  positionKey,
  toMoveLabel,
  disabled,
  onResult,
  pvShow,
  onPvShow,
}: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [thinkMs, setThinkMs] = useState(loadRapfiThink)
  const [progress, setProgress] = useState<RapfiLoadProgress | null>(null)
  const [result, setResult] = useState<RapfiAnalysis | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [everLoaded, setEverLoaded] = useState(false)
  const seqRef = useRef(0)
  /** 思考中已過秒數（長時間研究時顯示進度）。 */
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (phase !== 'thinking') return
    const t0 = Date.now()
    setElapsed(0)
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 500)
    return () => clearInterval(id)
  }, [phase])

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
    onResult(null)
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
      onResult(a)
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
              ? `Rapfi 思考中… ${elapsed}/${Math.round(thinkMs / 1000)} 秒`
              : 'Rapfi 分析'}
        </button>
        <select
          value={thinkMs}
          onChange={(e) => {
            setThinkMs(Number(e.target.value))
            saveRapfiThink(Number(e.target.value))
          }}
          aria-label="Rapfi 思考時間"
        >
          <option value={1000}>想 1 秒</option>
          <option value={3000}>想 3 秒</option>
          <option value={10000}>想 10 秒</option>
          <option value={30000}>想 30 秒（研究）</option>
          <option value={60000}>想 1 分鐘（研究）</option>
          <option value={120000}>想 2 分鐘（深入研究）</option>
        </select>
        <select
          value={pvShow}
          onChange={(e) => onPvShow(Number(e.target.value))}
          aria-label="建議路線顯示手數"
        >
          <option value={1}>只顯示下一手</option>
          <option value={6}>路線顯示 6 手</option>
          <option value={10}>路線顯示 10 手</option>
          <option value={0}>路線全部顯示</option>
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
            <p className="rapfi-pv">
              主變化：{result.pv.map(coordName).join(' → ')}
              <span className="muted small">（棋盤上半透明子；照著下會接著顯示下一手，走別的就收掉）</span>
            </p>
          )}
          <p className="rapfi-ms muted">實際思考 {(result.timeMs / 1000).toFixed(1)}s</p>
        </div>
      )}
    </div>
  )
}
