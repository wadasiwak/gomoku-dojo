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
// 之後走瀏覽器 HTTP cache）。單執行緒 build（GitHub Pages 設不了 COOP/COEP
// header，SharedArrayBuffer 多執行緒版不可用），思考期間 worker 阻塞、主執行緒
// 不受影響；stop() 只能 terminate worker 再重載（Gomocup YXSTOP 在單執行緒
// build 思考中收不到）。
//
// 與本站原創引擎（src/engine/client.ts EngineClient）完全獨立：Rapfi 只做
// 「分析」（研棋/擺譜的第二意見），對弈預設仍是本站引擎。
import { BLACK, WHITE, type Color, type Pos, type Rule } from '../engine/types.ts'
import {
  buildBoardCommand,
  buildThinkSetup,
  movesToStones,
  boardToStones,
  parseEngineLine,
  type StonePlacement,
} from './protocol.ts'

export const RAPFI_ATTRIBUTION =
  '分析引擎 Rapfi © dhbloo，GPL-3.0，原始碼 github.com/dhbloo/rapfi'

/** 分析輸入：二選一。moves＝黑先交替手順（對弈/重播）；board＝任意擺譜局面。 */
export type RapfiInput =
  | { moves: readonly Pos[] }
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
      const worker = new Worker(this.baseUrl + 'rapfi.worker.js') // classic worker
      this.worker = worker
      const timer = setTimeout(() => {
        fail(new Error(`Rapfi 載入逾時（${LOAD_TIMEOUT_MS / 1000}s）`))
      }, LOAD_TIMEOUT_MS)
      const fail = (err: Error) => {
        clearTimeout(timer)
        worker.terminate()
        this.worker = null
        this.loadPromise = null
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
      worker.postMessage({ type: 'load', glueURL: this.baseUrl + 'rapfi-single-simd128.js' })
    })
    return this.loadPromise
  }

  private handleMessage(msg: WorkerMsg): void {
    if (msg.type === 'stdout' && this.lineHandler) this.lineHandler(String(msg.data))
    // stderr/exit/status 在運轉期只當雜訊；exit 理論上只在 terminate 時發生
  }

  private send(cmd: string): void {
    this.worker!.postMessage({ type: 'command', data: cmd })
  }

  /**
   * 分析一個局面：回傳建議手＋評分＋主變化。
   * @param input 手順或擺譜局面（15×15，座標 0-based）
   * @param rule 'gomoku'（無禁手）| 'renju'（連珠：黑禁手，引擎自動迴避/利用）
   * @param thinkTimeMs 思考時間上限（預設 5000；殺棋會提早回）
   */
  analyze(input: RapfiInput, rule: Rule, thinkTimeMs = 5000): Promise<RapfiAnalysis> {
    const run = async (): Promise<RapfiAnalysis> => {
      await this.ensureLoaded()

      let stones: StonePlacement[]
      let toMove: Color
      if ('moves' in input) {
        stones = movesToStones(input.moves)
        toMove = input.moves.length % 2 === 0 ? BLACK : WHITE
      } else {
        stones = boardToStones(input.board.black, input.board.white)
        toMove = input.board.toMove
      }

      const t0 = Date.now()
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

        for (const cmd of buildThinkSetup(rule, thinkTimeMs)) this.send(cmd)
        this.send(buildBoardCommand(stones, toMove, true))
      })
    }
    // 佇列化：前一件分析完（或失敗）才跑下一件
    const next = this.queue.then(run, run)
    this.queue = next.catch(() => {})
    return next
  }

  /**
   * 中止當前思考。單執行緒 build 思考中收不到 YXSTOP，只能 terminate worker；
   * 下次 analyze 會重新載入引擎（artifacts 走 HTTP cache，代價是重新初始化）。
   */
  stop(): void {
    if (!this.worker) return
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
