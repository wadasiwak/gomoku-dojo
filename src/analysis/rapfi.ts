// Rapfi WASM 分析引擎的主執行緒客戶端。
//
// ── GPL 合規（UI 接線者請取用）───────────────────────────────────────────
// 站內 footer 致謝文字（原文照用）：
//   分析引擎 Rapfi © dhbloo，GPL-3.0，原始碼 github.com/dhbloo/rapfi
// 亦 export 為 RAPFI_ATTRIBUTION。授權全文與版本聲明在 public/rapfi/{LICENSE,README.md}。
// ─────────────────────────────────────────────────────────────────────────
//
// 架構：懶載入的獨立 classic Worker（public/rapfi/rapfi.worker.js）——首次呼叫
// analyze()/preload() 才 fetch 引擎（glue 39KB＋wasm 1.2MB＋NNUE 權重 40MB，
// 之後走瀏覽器 HTTP cache）。桌機且頁面 crossOriginIsolated（coi-serviceworker
// 補 COOP/COEP）時改用多執行緒 build（rapfi-multi.worker.js，2–8 緒，實測 4 緒約 4×），
// 否則單執行緒 build；思考期間主執行緒不受影響。stop() 一律 terminate worker 再重載
// （單執行緒 build 思考中收不到 YXSTOP；多執行緒版為求一致同樣處理）。
//
// 與本站原創引擎（src/engine/client.ts EngineClient）完全獨立：Rapfi 只做
// 「分析」（研棋/擺譜的第二意見），對弈預設仍是本站引擎。
import { BLACK, WHITE, type Color, type Pos, type Rule } from '../engine/types.ts'
import {
  buildBoardCommand,
  buildThinkSetup,
  movesToStones,
  boardToStones,
  orderedStones,
  parseEngineLine,
  type StonePlacement,
  type ThinkLimits,
} from './protocol.ts'

export const RAPFI_ATTRIBUTION =
  '分析引擎 Rapfi © dhbloo，GPL-3.0，原始碼 github.com/dhbloo/rapfi'

/** 分析輸入：moves＝黑先交替手順（對弈/重播）；ordered＝擺譜記錄的實際擺子順序；
 *  board＝只有盤面（不知順序，自動交錯排列）。 */
export type RapfiInput =
  | { moves: readonly Pos[] }
  | { ordered: { stones: readonly StonePlacement[]; toMove: Color } }
  | { board: { black: readonly Pos[]; white: readonly Pos[]; toMove: Color } }

export interface RapfiAnalysis {
  /** 建議手。 */
  move: Pos
  /** 主變化（第一手＝建議手；引擎沒輸出 BESTLINE 時退化為 [move]）。 */
  pv: Pos[]
  /** 引擎原生評分字串（待思考方視角），如 "+128"、"+M15"（15 步內必勝）；秒殺／定式手可能缺。 */
  evalText?: string
  /** 待思考方勝率 0..1（同上可能缺）。 */
  winrate?: number
  /** 完成的最大迭代深度。 */
  depth?: number
  /** 實際思考毫秒（本端量測）。 */
  timeMs: number
}

/** 多 PV（YXNBEST）單一候選：move＝該 PV 首手，evalText＝該候選分數（待思考方視角）。 */
export interface RapfiPvLine {
  move: Pos
  pv: Pos[]
  evalText?: string
  winrate?: number
  depth?: number
}

export interface RapfiNBestResult {
  /** 依 PV 序（0＝引擎認定最佳）；長度可能少於要求的 n（合法候選不足）。 */
  lines: RapfiPvLine[]
  timeMs: number
}

export interface RapfiLoadProgress {
  /** 0..1；權重檔（40MB）下載進度。 */
  progress: number
  loadedBytes?: number
  totalBytes?: number
}

interface WorkerMsg {
  type: 'ready' | 'stdout' | 'stderr' | 'status' | 'exit' | 'load-error'
  data?: string | number
}

const BOARD_SIZE_CMD = 'START 15'

/** 多執行緒版的執行緒數上限（實測 8 緒約 8.6×；再多邊際小、記憶體大）。 */
const MAX_THREADS = 8

/**
 * 多執行緒版可用條件：頁面 crossOriginIsolated（coi-serviceworker 補 COOP/COEP 後成立）
 * ＋SharedArrayBuffer＋非行動裝置。行動裝置（尤其 iOS）未實機驗證、記憶體吃緊，
 * 一律走單執行緒版（index.html 也只在桌機註冊 coi-serviceworker）。
 */
/**
 * 崩潰保險（sessionStorage，同分頁重新整理後仍在）：多執行緒版偶發分頁崩潰
 * （headless 測試數十次中出現約 3 次、原因未查明）。思考開始時記 MT_BUSY、結束清掉；
 * 若載入時發現 MT_BUSY 還在＝上次在思考中崩潰（或思考中被重新整理）→ 本分頁改用
 * 單執行緒版（MT_OFF），讓崩潰最多發生一次。
 */
const MT_BUSY = 'gomoku-dojo-rapfi-mt-busy'
const MT_OFF = 'gomoku-dojo-rapfi-mt-off'

function session(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

/** 本分頁是否因崩潰保險而停用多執行緒（UI 提示用）。 */
export function multiThreadDisabledByCrashGuard(): boolean {
  return session()?.getItem(MT_OFF) === '1'
}

/**
 * 多執行緒總開關：2026-10-14 關閉（國手決定，名人賽前求穩）。node 實測多執行緒版連續搜尋一段時間後
 * 會不定時卡死（同局面單獨重算又正常＝引擎內部競態；START 後立刻送 THREAD_NUM 也會死鎖），
 * 單執行緒版同批局面全過。查清楚前一律單執行緒；要恢復：改 true，並把 index.html 的
 * coi-serviceworker 設定改回註冊（shouldRegister）。
 */
export const MULTI_THREAD_ENABLED = false

function multiThreadCount(): number {
  if (!MULTI_THREAD_ENABLED) return 1
  if (typeof self === 'undefined' || typeof navigator === 'undefined') return 1
  const ss = session()
  if (ss?.getItem(MT_BUSY)) {
    ss.removeItem(MT_BUSY)
    ss.setItem(MT_OFF, '1')
  }
  if (ss?.getItem(MT_OFF) === '1') return 1
  const isolated = (self as { crossOriginIsolated?: boolean }).crossOriginIsolated === true
  if (!isolated || typeof SharedArrayBuffer !== 'function') return 1
  if (/iPhone|iPad|iPod|Android|Mobile/i.test(navigator.userAgent)) return 1
  return Math.max(2, Math.min(navigator.hardwareConcurrency || 4, MAX_THREADS))
}
/** 載入整體 timeout：慢網抓 40MB 權重也該在此限內完成。 */
const LOAD_TIMEOUT_MS = 120_000

/** 瀏覽器能力檢查：wasm SIMD（固定 simd128 build 需要）。Safari 16.4+/Chrome 91+/Firefox 89+。 */
export function isRapfiSupported(): boolean {
  if (typeof WebAssembly !== 'object' || typeof Worker !== 'function') return false
  try {
    // 最小 SIMD 模組：(module (func (result v128) v128.const i32x4 0 0 0 0 drop ...))
    // 取自 wasm-feature-detect 的 simd 檢測 bytes。
    return WebAssembly.validate(
      new Uint8Array([
        0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0,
        253, 15, 253, 98, 11,
      ]),
    )
  } catch {
    return false
  }
}

export class RapfiClient {
  private worker: Worker | null = null
  private loadPromise: Promise<void> | null = null
  /** analyze 序列化佇列：單執行緒引擎一次只能想一件事。 */
  private queue: Promise<unknown> = Promise.resolve()
  private lineHandler: ((line: string) => void) | null = null
  private onProgress: ((p: RapfiLoadProgress) => void) | null = null
  private readonly baseUrl: string
  /** 引擎執行緒數：>1＝多執行緒版（rapfi-multi.worker.js）；載入失敗會降回 1。 */
  threads: number = multiThreadCount()

  /** @param baseUrl artifacts 目錄；預設相對於頁面 URL 的 `rapfi/`（dev 與 GitHub Pages 子路徑皆可）。 */
  constructor(baseUrl?: string) {
    this.baseUrl =
      baseUrl ?? new URL('rapfi/', typeof document !== 'undefined' ? document.baseURI : 'http://localhost/').href
  }

  /** 預載引擎（可選；analyze 首呼叫也會自動載）。onProgress 回報權重下載進度。 */
  preload(onProgress?: (p: RapfiLoadProgress) => void): Promise<void> {
    if (onProgress) this.onProgress = onProgress
    return this.ensureLoaded()
  }

  private ensureLoaded(): Promise<void> {
    if (this.loadPromise) return this.loadPromise
    this.loadPromise = new Promise<void>((resolve, reject) => {
      const multi = this.threads > 1
      const worker = new Worker(this.baseUrl + (multi ? 'rapfi-multi.worker.js' : 'rapfi.worker.js')) // classic worker
      this.worker = worker
      const timer = setTimeout(() => {
        fail(new Error(`Rapfi 載入逾時（${LOAD_TIMEOUT_MS / 1000}s）`))
      }, LOAD_TIMEOUT_MS)
      const fail = (err: Error) => {
        clearTimeout(timer)
        worker.terminate()
        this.worker = null
        this.loadPromise = null
        if (multi) {
          // 多執行緒版載不起來 → 降回單執行緒版重載（不讓使用者卡在錯誤）
          console.error('Rapfi 多執行緒版載入失敗，改用單執行緒版', err)
          this.threads = 1
          this.ensureLoaded().then(resolve, reject)
          return
        }
        reject(err)
      }
      worker.onerror = (ev) => fail(new Error(`Rapfi worker 錯誤：${ev.message || 'unknown'}`))
      worker.onmessage = (ev: MessageEvent<WorkerMsg>) => {
        const msg = ev.data
        switch (msg.type) {
          case 'ready':
            clearTimeout(timer)
            // 之後的訊息交給常駐 handler
            worker.onmessage = (e: MessageEvent<WorkerMsg>) => this.handleMessage(e.data)
            // 多執行緒版：THREAD_NUM 必須在 START 之前送（START 後立刻改會死鎖）
            if (multi) this.send(`INFO THREAD_NUM ${this.threads}`)
            this.send(BOARD_SIZE_CMD) // 回覆 "OK"，由 handler 忽略
            resolve()
            break
          case 'load-error':
            fail(new Error(`Rapfi 載入失敗：${msg.data}`))
            break
          case 'status': {
            // Emscripten setStatus："Downloading data... (loaded/total)"
            const m = /\((\d+)\/(\d+)\)/.exec(String(msg.data ?? ''))
            if (m && this.onProgress)
              this.onProgress({ progress: +m[1] / +m[2], loadedBytes: +m[1], totalBytes: +m[2] })
            break
          }
          default:
            break // 載入階段的 stdout（讀 config 等 MESSAGE）不用管
        }
      }
      worker.postMessage({
        type: 'load',
        glueURL: this.baseUrl + (multi ? 'rapfi-multi-simd128.js' : 'rapfi-single-simd128.js'),
      })
    })
    return this.loadPromise
  }

  private handleMessage(msg: WorkerMsg): void {
    if (msg.type === 'stdout' && this.lineHandler) this.lineHandler(String(msg.data))
    if (msg.type === 'exit') {
      // 引擎行程結束（多執行緒版讀到 EOF 等異常）→ 在途思考立即報錯、下次呼叫重載
      const handler = this.lineHandler
      this.stop()
      handler?.(`ERROR 引擎意外結束（exit ${msg.data}）`)
    }
    // stderr/status 在運轉期只當雜訊
  }

  private send(cmd: string): void {
    this.worker!.postMessage({ type: 'command', data: cmd })
  }

  /**
   * 分析一個局面：回傳建議手＋評分＋主變化。
   * @param input 手順或擺譜局面（15×15，座標 0-based）
   * @param rule 'gomoku'（無禁手）| 'renju'（連珠：黑禁手，引擎自動迴避/利用）
   * @param thinkTimeMs 思考時間上限（預設 5000；殺棋會提早回）
   * @param limits 深度／節點／執行緒上限（對弈強度分級用；分析不給＝全力）
   */
  analyze(
    input: RapfiInput,
    rule: Rule,
    thinkTimeMs = 5000,
    limits: ThinkLimits = {},
  ): Promise<RapfiAnalysis> {
    const run = async (): Promise<RapfiAnalysis> => {
      await this.ensureLoaded()

      let stones: StonePlacement[]
      let toMove: Color
      if ('moves' in input) {
        stones = movesToStones(input.moves)
        toMove = input.moves.length % 2 === 0 ? BLACK : WHITE
      } else if ('ordered' in input) {
        stones = orderedStones(input.ordered.stones, input.ordered.toMove)
        toMove = input.ordered.toMove
      } else {
        stones = boardToStones(input.board.black, input.board.white, input.board.toMove)
        toMove = input.board.toMove
      }

      const t0 = Date.now()
      this.markBusy(true)
      return await new Promise<RapfiAnalysis>((resolve, reject) => {
        let evalText: string | undefined
        let winrate: number | undefined
        let depth: number | undefined
        let pv: Pos[] = []
        // 思考 timeout 保險絲：引擎自身會守 TIMEOUT_TURN，這裡給寬裕邊際防 worker 卡死。
        const timer = setTimeout(() => {
          this.lineHandler = null
          reject(new Error(`Rapfi 思考逾時（>${thinkTimeMs + 30_000}ms），worker 可能異常`))
        }, thinkTimeMs + 30_000)

        this.lineHandler = (line) => {
          const ev = parseEngineLine(line)
          switch (ev.kind) {
            case 'eval':
              evalText = ev.text
              break
            case 'winrate':
              winrate = ev.value
              break
            case 'depth':
              depth = ev.value
              break
            case 'bestline':
              if (ev.pv.length > 0) pv = ev.pv
              break
            case 'move':
              clearTimeout(timer)
              this.lineHandler = null
              resolve({
                move: ev.pos,
                // BESTLINE 首手應等於最終落點；不一致（或沒輸出）時退化為只含建議手
                pv: pv.length > 0 && pv[0].x === ev.pos.x && pv[0].y === ev.pos.y ? pv : [ev.pos],
                evalText,
                winrate,
                depth,
                timeMs: Date.now() - t0,
              })
              break
            case 'error':
              clearTimeout(timer)
              this.lineHandler = null
              reject(new Error(`Rapfi：${ev.text}`))
              break
            default:
              break // message/other/forbid/swap：分析流程中皆為雜訊
          }
        }

        for (const cmd of buildThinkSetup(rule, thinkTimeMs, { ...limits, threads: this.threads }))
          this.send(cmd)
        this.send(buildBoardCommand(stones, toMove, true))
      })
    }
    // 佇列化：前一件分析完（或失敗）才跑下一件
    const next = this.queue.then(run, run).finally(() => this.markBusy(false))
    this.queue = next.catch(() => {})
    return next
  }

  /**
   * 多 PV 分析：回傳 n 個最佳候選（各含首手/評分/主變化）。規約兩打（黑提兩個
   * 互不等價的第 5 手）等「要不只一個建議」的場景用。
   * 協定（實測見 protocol.ts 檔頭）：YXBOARD 設局面後送 `YXNBEST n`（該指令本身
   * 觸發思考）；每輪迭代對每個 PV 輸出 INFO PV <i> … INFO PV DONE 區塊，
   * 結束仍只回單行最佳手——候選組回「最後一輪」各 PV 區塊（BESTLINE 首手＋EVAL）。
   */
  analyzeNBest(
    input: RapfiInput,
    rule: Rule,
    n: number,
    thinkTimeMs = 3000,
    limits: ThinkLimits = {},
  ): Promise<RapfiNBestResult> {
    const run = async (): Promise<RapfiNBestResult> => {
      await this.ensureLoaded()

      let stones: StonePlacement[]
      let toMove: Color
      if ('moves' in input) {
        stones = movesToStones(input.moves)
        toMove = input.moves.length % 2 === 0 ? BLACK : WHITE
      } else if ('ordered' in input) {
        stones = orderedStones(input.ordered.stones, input.ordered.toMove)
        toMove = input.ordered.toMove
      } else {
        stones = boardToStones(input.board.black, input.board.white, input.board.toMove)
        toMove = input.board.toMove
      }

      const t0 = Date.now()
      this.markBusy(true)
      return await new Promise<RapfiNBestResult>((resolve, reject) => {
        /** 每個 PV index 的最新已完成區塊（逐輪迭代覆寫，留最後一輪）。 */
        const committed = new Map<number, RapfiPvLine>()
        let cur: (RapfiPvLine & { index: number }) | null = null
        const timer = setTimeout(() => {
          this.lineHandler = null
          reject(new Error(`Rapfi 思考逾時（>${thinkTimeMs + 30_000}ms），worker 可能異常`))
        }, thinkTimeMs + 30_000)

        this.lineHandler = (line) => {
          const ev = parseEngineLine(line)
          switch (ev.kind) {
            case 'pv':
              cur = { index: ev.index, move: { x: -1, y: -1 }, pv: [] }
              break
            case 'eval':
              if (cur) cur.evalText = ev.text
              break
            case 'winrate':
              if (cur) cur.winrate = ev.value
              break
            case 'depth':
              if (cur) cur.depth = ev.value
              break
            case 'bestline':
              if (cur && ev.pv.length > 0) {
                cur.pv = ev.pv
                cur.move = ev.pv[0]
              }
              break
            case 'pvdone':
              // 沒有 BESTLINE 的區塊（理論上不會有）不進結果
              if (cur && cur.pv.length > 0)
                committed.set(cur.index, {
                  move: cur.move,
                  pv: cur.pv,
                  evalText: cur.evalText,
                  winrate: cur.winrate,
                  depth: cur.depth,
                })
              cur = null
              break
            case 'move': {
              clearTimeout(timer)
              this.lineHandler = null
              const lines = [...committed.entries()]
                .sort((a, z) => a[0] - z[0])
                .map(([, l]) => l)
              // 秒殺／定式手可能完全沒有 PV 區塊 → 退化為單一建議手
              resolve({
                lines: lines.length > 0 ? lines : [{ move: ev.pos, pv: [ev.pos] }],
                timeMs: Date.now() - t0,
              })
              break
            }
            case 'error':
              clearTimeout(timer)
              this.lineHandler = null
              reject(new Error(`Rapfi：${ev.text}`))
              break
            default:
              break
          }
        }

        for (const cmd of buildThinkSetup(rule, thinkTimeMs, { ...limits, threads: this.threads }))
          this.send(cmd)
        this.send(buildBoardCommand(stones, toMove, false)) // YXBOARD：只設局面
        this.send(`YXNBEST ${n}`) // 指令本身觸發思考
      })
    }
    const next = this.queue.then(run, run).finally(() => this.markBusy(false))
    this.queue = next.catch(() => {})
    return next
  }

  /** 崩潰保險記號：只有多執行緒版需要。 */
  private markBusy(on: boolean): void {
    if (this.threads <= 1) return
    const ss = session()
    if (!ss) return
    if (on) ss.setItem(MT_BUSY, '1')
    else ss.removeItem(MT_BUSY)
  }

  /**
   * 中止當前思考。單執行緒 build 思考中收不到 YXSTOP，只能 terminate worker；
   * 下次 analyze 會重新載入引擎（artifacts 走 HTTP cache，代價是重新初始化）。
   */
  stop(): void {
    if (!this.worker) return
    this.markBusy(false) // 主動中止不算崩潰
    this.worker.terminate()
    this.worker = null
    this.loadPromise = null
    this.lineHandler = null
    this.queue = Promise.resolve()
  }

  dispose(): void {
    this.stop()
  }
}

let singleton: RapfiClient | null = null

/** 全站共用單例（懶建）。 */
export function getRapfi(): RapfiClient {
  if (!singleton) singleton = new RapfiClient()
  return singleton
}
