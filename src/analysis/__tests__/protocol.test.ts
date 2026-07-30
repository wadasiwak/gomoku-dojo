// Rapfi 協定層單元測試。所有解析測資都是對 wasm build（rapfi 3c94c2a）
// 實跑收集的原始輸出行，不是照文件抄的。
import { describe, expect, it } from 'vitest'
import { BLACK, WHITE } from '../../engine/types.ts'
import {
  RULE_CODE,
  buildBoardCommand,
  buildThinkSetup,
  movesToStones,
  boardToStones,
  parseEngineLine,
} from '../protocol.ts'

describe('RULE_CODE', () => {
  it('gomoku→0（FREESTYLE）、renju→4（RENJU）', () => {
    expect(RULE_CODE.gomoku).toBe(0)
    expect(RULE_CODE.renju).toBe(4)
  })
})

describe('buildBoardCommand', () => {
  it('空盤（黑先思考）→ BOARD DONE', () => {
    expect(buildBoardCommand([], BLACK)).toBe('BOARD DONE')
  })

  it('交替手順、輪白思考：白子 side=1、黑子 side=2', () => {
    const stones = movesToStones([
      { x: 7, y: 7 }, // 黑
      { x: 7, y: 8 }, // 白
      { x: 8, y: 6 }, // 黑
    ])
    expect(buildBoardCommand(stones, WHITE)).toBe('BOARD 7,7,2 7,8,1 8,6,2 DONE')
  })

  it('輪黑思考：黑子 side=1', () => {
    const stones = movesToStones([
      { x: 7, y: 7 },
      { x: 7, y: 8 },
    ])
    expect(buildBoardCommand(stones, BLACK)).toBe('BOARD 7,7,1 7,8,2 DONE')
  })

  it('擺譜局面（黑白數量不等）＋ YXBOARD', () => {
    const stones = boardToStones([{ x: 7, y: 6 }, { x: 7, y: 8 }], [{ x: 3, y: 0 }])
    expect(buildBoardCommand(stones, BLACK, false)).toBe('YXBOARD 7,6,1 7,8,1 3,0,2 DONE')
  })
})

describe('parseEngineLine（實測輸出行）', () => {
  it('最佳手 "7,7"', () => {
    expect(parseEngineLine('7,7')).toEqual({ kind: 'move', pos: { x: 7, y: 7 } })
  })

  it('INFO EVAL "+M1"（原生字串照留）', () => {
    expect(parseEngineLine('INFO EVAL +M1')).toEqual({ kind: 'eval', text: '+M1' })
  })

  it('INFO WINRATE / DEPTH / NODES', () => {
    expect(parseEngineLine('INFO WINRATE 1')).toEqual({ kind: 'winrate', value: 1 })
    expect(parseEngineLine('INFO DEPTH 26')).toEqual({ kind: 'depth', value: 26 })
    expect(parseEngineLine('INFO NODES 0')).toEqual({ kind: 'nodes', value: 0 })
  })

  it('INFO BESTLINE 主變化', () => {
    expect(parseEngineLine('INFO BESTLINE 7,6 7,5 8,6 5,6')).toEqual({
      kind: 'bestline',
      pv: [
        { x: 7, y: 6 },
        { x: 7, y: 5 },
        { x: 8, y: 6 },
        { x: 5, y: 6 },
      ],
    })
  })

  it('FORBID 兩位數座標對（尾隨句點）', () => {
    expect(parseEngineLine('FORBID 0707.')).toEqual({
      kind: 'forbid',
      points: [{ x: 7, y: 7 }],
    })
    expect(parseEngineLine('FORBID 07071214.')).toEqual({
      kind: 'forbid',
      points: [
        { x: 7, y: 7 },
        { x: 12, y: 14 },
      ],
    })
  })

  it('MESSAGE 與 ERROR', () => {
    expect(parseEngineLine('MESSAGE mix9svq nnue: weight loaded in 76ms')).toEqual({
      kind: 'message',
      text: 'mix9svq nnue: weight loaded in 76ms',
    })
    expect(parseEngineLine('ERROR Unknown rule id: 9. Rule is reset to freestyle...')).toMatchObject({
      kind: 'error',
    })
  })

  it('OK／未知行歸 other，不炸', () => {
    expect(parseEngineLine('OK').kind).toBe('other')
    expect(parseEngineLine('INFO PV DONE').kind).toBe('other')
    expect(parseEngineLine('INFO MAX_HASH_SIZE 30').kind).toBe('other')
  })
})

describe('buildThinkSetup', () => {
  it('renju＋3000ms：帶規則碼與思考時限', () => {
    const cmds = buildThinkSetup('renju', 3000)
    expect(cmds).toContain('INFO RULE 4')
    expect(cmds).toContain('INFO TIMEOUT_TURN 3000')
    expect(cmds).toContain('INFO SHOW_DETAIL 2')
  })
})
