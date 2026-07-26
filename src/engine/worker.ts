// Web Worker 入口：引擎重活（搜索/VCF/全盤禁手掃描）在這裡跑，主執行緒不卡。
// Message protocol（request/response 皆帶 id 配對）：
//   → { id, type: 'search',  board: number[], color, rule, level }
//   → { id, type: 'vcf',     board: number[], color, rule, maxDepth?, timeLimitMs? }
//   → { id, type: 'forbidden', board: number[] }           // 全盤黑禁手點
//   → { id, type: 'ping' }
//   ← { id, ok: true, result } | { id, ok: false, error }
import type { Color, Rule } from './types.ts'
import { search, LEVELS } from './search.ts'
import { solveVcf } from './vcf.ts'
import { findForbiddenPoints } from './forbidden.ts'

export type WorkerRequest =
  | { id: number; type: 'search'; board: number[]; color: Color; rule: Rule; level: 1 | 2 | 3 | 4 }
  | {
      id: number
      type: 'vcf'
      board: number[]
      color: Color
      rule: Rule
      maxDepth?: number
      timeLimitMs?: number
      maxNodes?: number
    }
  | { id: number; type: 'forbidden'; board: number[] }
  | { id: number; type: 'ping' }

export type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string }

function handle(req: WorkerRequest): unknown {
  switch (req.type) {
    case 'ping':
      return 'pong'
    case 'search': {
      const b = Uint8Array.from(req.board)
      return search(b, req.color, { rule: req.rule, ...LEVELS[req.level] })
    }
    case 'vcf': {
      const b = Uint8Array.from(req.board)
      return solveVcf(b, req.color, req.rule, {
        maxDepth: req.maxDepth,
        timeLimitMs: req.timeLimitMs,
        maxNodes: req.maxNodes,
      })
    }
    case 'forbidden': {
      const b = Uint8Array.from(req.board)
      return findForbiddenPoints(b)
    }
  }
}

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data
  try {
    const result = handle(req)
    const res: WorkerResponse = { id: req.id, ok: true, result }
    self.postMessage(res)
  } catch (e) {
    const res: WorkerResponse = { id: req.id, ok: false, error: String(e) }
    self.postMessage(res)
  }
}
