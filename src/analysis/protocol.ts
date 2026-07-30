// Rapfi（Gomocup/Yixin-Board 協定）的指令組裝與輸出解析。
// 純函式、零 DOM 依賴——可在 node（vitest／scripts/rapfi-smoke.mjs）直接測。
//
// 協定事實（對 rapfi commit 3c94c2a 的 wasm build 實測所得，見 scripts/rapfi-smoke.mjs）：
// - 座標 wire format 為 "x,y"（0-based），輸入輸出同一座標框、不做翻轉
//   （config.toml 的 coord_conversion_mode 只影響 Yixin-Board GUI 模式，實測 round-trip 一致）。
// - `BOARD x,y,side … DONE`：side 1＝待思考方的子、2＝對方的子；空盤送 `BOARD DONE`，
//   引擎立即思考並以單獨一行 "x,y" 回覆最佳手。
// - `INFO SHOW_DETAIL 2` 時，思考過程逐迭代輸出 `INFO DEPTH/EVAL/WINRATE/BESTLINE …`，
//   最後一行才是 "x,y" 落點；秒殺／開局定式手可能完全沒有 INFO 行（欄位要 optional）。
// - EVAL 是引擎原生字串（如 "+128"、"+M15"＝15 步內必勝、"-M6"）；WINRATE 0..1。
// - `YXSHOWFORBID` 回 `FORBID xxyy xxyy .`（兩位數座標對，尾隨句點）。
import { BLACK, WHITE, type Color, type Pos, type Rule } from '../engine/types.ts'

/** Gomocup INFO RULE 代碼：本站 gomoku（無禁、長連勝）→ 0 FREESTYLE；renju → 4 RENJU。 */
export const RULE_CODE: Record<Rule, number> = { gomoku: 0, renju: 4 }

export interface StonePlacement {
  pos: Pos
  color: Color
}

/** 交替手順（黑先）→ 帶色棋子清單。 */
export function movesToStones(moves: readonly Pos[]): StonePlacement[] {
  return moves.map((pos, i) => ({ pos, color: i % 2 === 0 ? BLACK : WHITE }))
}

/** 任意局面（擺譜）→ 帶色棋子清單。黑子在前，維持穩定順序。 */
export function boardToStones(black: readonly Pos[], white: readonly Pos[]): StonePlacement[] {
  return [
    ...black.map((pos) => ({ pos, color: BLACK as Color })),
    ...white.map((pos) => ({ pos, color: WHITE as Color })),
  ]
}

/**
 * 組 BOARD/YXBOARD 指令。side 欄位以 toMove 為基準：toMove 方的子＝1、對方＝2。
 * immediate=true 用 `BOARD`（送完立即思考）；false 用 `YXBOARD`（只設局面）。
 */
export function buildBoardCommand(
  stones: readonly StonePlacement[],
  toMove: Color,
  immediate = true,
): string {
  const head = immediate ? 'BOARD' : 'YXBOARD'
  const parts = stones.map(
    ({ pos, color }) => `${pos.x},${pos.y},${color === toMove ? 1 : 2}`,
  )
  return [head, ...parts, 'DONE'].join(' ')
}

/** 引擎輸出一行的解析結果。 */
export type EngineLine =
  | { kind: 'move'; pos: Pos } // 最佳手（思考結束）
  | { kind: 'eval'; text: string } // 原生評分字串，如 "+128"、"+M15"
  | { kind: 'winrate'; value: number } // 0..1
  | { kind: 'depth'; value: number }
  | { kind: 'nodes'; value: number }
  | { kind: 'bestline'; pv: Pos[] } // 主變化（第一手＝建議手）
  | { kind: 'forbid'; points: Pos[] } // YXSHOWFORBID 回覆
  | { kind: 'message'; text: string } // MESSAGE 雜訊（載入權重、思考摘要等）
  | { kind: 'error'; text: string }
  | { kind: 'swap' } // SWAP 規則用，本站不會觸發，誠實保留
  | { kind: 'other'; text: string }

const MOVE_RE = /^(\d+),(\d+)$/

export function parseEngineLine(line: string): EngineLine {
  const m = MOVE_RE.exec(line)
  if (m) return { kind: 'move', pos: { x: +m[1], y: +m[2] } }
  if (line === 'SWAP') return { kind: 'swap' }
  if (line === 'OK') return { kind: 'other', text: line }

  const sp = line.indexOf(' ')
  if (sp === -1) return { kind: 'other', text: line }
  const head = line.slice(0, sp)
  const tail = line.slice(sp + 1)

  if (head === 'MESSAGE') return { kind: 'message', text: tail }
  if (head === 'ERROR') return { kind: 'error', text: tail }
  if (head === 'FORBID') {
    const points = (tail.match(/\d{4}/g) ?? []).map((s) => ({
      x: +s.slice(0, 2),
      y: +s.slice(2, 4),
    }))
    return { kind: 'forbid', points }
  }
  if (head === 'INFO') {
    const sp2 = tail.indexOf(' ')
    if (sp2 === -1) return { kind: 'other', text: line }
    const key = tail.slice(0, sp2)
    const val = tail.slice(sp2 + 1)
    switch (key) {
      case 'EVAL':
        return { kind: 'eval', text: val }
      case 'WINRATE':
        return { kind: 'winrate', value: parseFloat(val) }
      case 'DEPTH':
        return { kind: 'depth', value: +val }
      case 'NODES':
        return { kind: 'nodes', value: +val }
      case 'BESTLINE': {
        const pv = (val.match(/\d+,\d+/g) ?? []).map((s) => {
          const [x, y] = s.split(',')
          return { x: +x, y: +y }
        })
        return { kind: 'bestline', pv }
      }
      default:
        return { kind: 'other', text: line }
    }
  }
  return { kind: 'other', text: line }
}

/** analyze 一次思考前要送的設定指令（不含 START/BOARD）。 */
export function buildThinkSetup(rule: Rule, thinkTimeMs: number): string[] {
  return [
    `INFO RULE ${RULE_CODE[rule]}`,
    'INFO THREAD_NUM 1', // 單執行緒 build
    `INFO TIMEOUT_TURN ${thinkTimeMs}`,
    'INFO TIMEOUT_MATCH 0', // 0＝不限總時
    'INFO TIME_LEFT 2147483647', // 協定值：不限剩餘時間
    'INFO SHOW_DETAIL 2', // 逐迭代輸出 INFO EVAL/WINRATE/BESTLINE
    'INFO MAX_DEPTH 100',
    'INFO MAX_NODE 0', // 0＝不限節點
  ]
}
