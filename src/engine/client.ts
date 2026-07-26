// 主執行緒側的引擎 Worker 客戶端：promise 化的 message protocol 封裝。
import type { Color, Rule } from './types.ts'
import type { Board } from './board.ts'
import type { SearchResult } from './search.ts'
import type { VcfResult } from './vcf.ts'
import type { WorkerRequest, WorkerResponse } from './worker.ts'

/** Omit 不會分配到 union 的每個成員，這裡手動分配。 */
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never

export class EngineClient {
  private worker: Worker
  private nextId = 1
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

  constructor() {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const res = ev.data
      const p = this.pending.get(res.id)
      if (!p) return
      this.pending.delete(res.id)
      if (res.ok) p.resolve(res.result)
      else p.reject(new Error(res.error))
    }
  }

  private call<T>(req: WithoutId<WorkerRequest>): Promise<T> {
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      this.worker.postMessage({ ...req, id })
    })
  }

  search(board: Board, color: Color, rule: Rule, level: 1 | 2 | 3 | 4): Promise<SearchResult> {
    return this.call({ type: 'search', board: [...board], color, rule, level })
  }

  vcf(
    board: Board,
    color: Color,
    rule: Rule,
    opts: { maxDepth?: number; timeLimitMs?: number; maxNodes?: number } = {},
  ): Promise<VcfResult> {
    return this.call({ type: 'vcf', board: [...board], color, rule, ...opts })
  }

  forbiddenPoints(board: Board): Promise<{ index: number; kind: string }[]> {
    return this.call({ type: 'forbidden', board: [...board] })
  }

  dispose(): void {
    this.worker.terminate()
    this.pending.clear()
  }
}
