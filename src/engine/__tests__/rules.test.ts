// 勝負判定 + 對局狀態機 + 棋譜 + Zobrist 基本測試。
import { describe, it, expect } from 'vitest'
import { parseBoard } from '../testutils.ts'
import { BLACK, WHITE, idx } from '../types.ts'
import { isWinningMove, makesExactFive, makesOverline } from '../rules.ts'
import { Game } from '../game.ts'
import { serializeRecord, parseRecord } from '../record.ts'
import { hashBoard, emptyHash, xorStone, hashKey } from '../zobrist.ts'
import { createBoard, set } from '../board.ts'

describe('勝負判定', () => {
  it('黑恰好五連：renju 與 gomoku 都算勝', () => {
    const { board, star } = parseBoard(`
      ...............
      ...............
      ...............
      ...............
      ...............
      ...............
      ...............
      ..XX*XX........
    `)
    board[idx(star!.x, star!.y)] = BLACK
    expect(makesExactFive(board, star!.x, star!.y, BLACK)).toBe(true)
    expect(isWinningMove(board, star!.x, star!.y, BLACK, 'renju')).toBe(true)
    expect(isWinningMove(board, star!.x, star!.y, BLACK, 'gomoku')).toBe(true)
  })

  it('黑六連：renju 非勝（長連）、gomoku 算勝', () => {
    const { board, star } = parseBoard(`
      ...............
      ..XXX*XX.......
    `)
    board[idx(star!.x, star!.y)] = BLACK
    expect(makesOverline(board, star!.x, star!.y, BLACK)).toBe(true)
    expect(isWinningMove(board, star!.x, star!.y, BLACK, 'renju')).toBe(false)
    expect(isWinningMove(board, star!.x, star!.y, BLACK, 'gomoku')).toBe(true)
  })

  it('白六連：renju 也算勝（白無禁手、長連算勝）', () => {
    const { board, star } = parseBoard(`
      ...............
      ..OOO*OO.......
    `)
    board[idx(star!.x, star!.y)] = WHITE
    expect(isWinningMove(board, star!.x, star!.y, WHITE, 'renju')).toBe(true)
  })

  it('邊線恰好五連（貼牆）算勝', () => {
    const { board, star } = parseBoard(`XXXX*`)
    board[idx(star!.x, star!.y)] = BLACK
    expect(makesExactFive(board, star!.x, star!.y, BLACK)).toBe(true)
  })

  it('兩端被白擋的五連仍是恰好五連', () => {
    const { board, star } = parseBoard(`
      ...............
      .OXXXX*O.......
    `)
    board[idx(star!.x, star!.y)] = BLACK
    expect(makesExactFive(board, star!.x, star!.y, BLACK)).toBe(true)
  })

  it('四連不是五連', () => {
    const { board, star } = parseBoard(`
      ...............
      ..XXX*.........
    `)
    board[idx(star!.x, star!.y)] = BLACK
    expect(makesExactFive(board, star!.x, star!.y, BLACK)).toBe(false)
  })
})

describe('對局狀態機', () => {
  it('黑先手、輪替、悔棋還原', () => {
    const g = new Game('renju')
    expect(g.toMove).toBe(BLACK)
    expect(g.play(7, 7)).toBe(true)
    expect(g.toMove).toBe(WHITE)
    expect(g.play(7, 7)).toBe(false) // 占用
    expect(g.play(8, 8)).toBe(true)
    expect(g.undo()).toBe(true)
    expect(g.toMove).toBe(WHITE)
    expect(g.board[idx(8, 8)]).toBe(0)
  })

  it('renju：黑連五勝', () => {
    const g = new Game('renju')
    // 黑 (3..7,7)，白 (3..6,8)
    for (let i = 0; i < 4; i++) {
      g.play(3 + i, 7)
      g.play(3 + i, 8)
    }
    g.play(7, 7)
    expect(g.result).toEqual({ kind: 'win', winner: BLACK, reason: 'five' })
  })

  it('renju：黑下長連點 → 踩禁手判負（白勝）', () => {
    const g = new Game('renju')
    // 黑 3,4,5 + 7,8 → 下 6 成六連（白的應手互不相鄰，避免白先成五）
    const blackXs = [3, 4, 5, 7, 8]
    for (let i = 0; i < blackXs.length; i++) {
      g.play(blackXs[i], 7)
      g.play(i * 2, 12)
    }
    expect(g.play(6, 7)).toBe(true)
    expect(g.result).toEqual({ kind: 'win', winner: WHITE, reason: 'forbidden' })
  })

  it('gomoku：黑六連直接勝（無禁手）', () => {
    const g = new Game('gomoku')
    const blackXs = [3, 4, 5, 7, 8]
    for (let i = 0; i < blackXs.length; i++) {
      g.play(blackXs[i], 7)
      g.play(i * 2, 12)
    }
    g.play(6, 7)
    expect(g.result).toEqual({ kind: 'win', winner: BLACK, reason: 'overline' })
  })

  it('對局結束後不可再落子；悔棋可拉回進行中', () => {
    const g = new Game('gomoku')
    for (let i = 0; i < 4; i++) {
      g.play(3 + i, 7)
      g.play(3 + i, 8)
    }
    g.play(7, 7)
    expect(g.result.kind).toBe('win')
    expect(g.play(0, 0)).toBe(false)
    g.undo()
    expect(g.result.kind).toBe('ongoing')
  })
})

describe('棋譜序列化', () => {
  it('serialize/parse 往返一致', () => {
    const g = new Game('renju')
    g.play(7, 7)
    g.play(7, 6)
    g.play(8, 8)
    const s = g.serialize()
    expect(s).toBe('r1:hhhgii')
    const rec = parseRecord(s)
    expect(rec).not.toBeNull()
    expect(rec!.rule).toBe('renju')
    expect(rec!.moves).toEqual([
      { x: 7, y: 7 },
      { x: 7, y: 6 },
      { x: 8, y: 8 },
    ])
    const replayed = Game.fromRecord(rec!)
    expect(replayed).not.toBeNull()
    expect(replayed!.serialize()).toBe(s)
  })

  it('非法棋譜一律回 null', () => {
    expect(parseRecord('x1:hh')).toBeNull() // 未知規則
    expect(parseRecord('r1:h')).toBeNull() // 奇數長度
    expect(parseRecord('r1:hp')).toBeNull() // 座標超界（p 不在 a-o）
    expect(parseRecord('r1:hhhh')).toBeNull() // 重複落子
    expect(parseRecord('r2:hh')).toBeNull() // 版本不符
    expect(parseRecord(serializeRecord({ rule: 'gomoku', moves: [{ x: 0, y: 14 }] }))).toEqual({
      rule: 'gomoku',
      moves: [{ x: 0, y: 14 }],
    })
  })
})

describe('Zobrist 一致性', () => {
  it('增量 XOR 與全盤重算一致；異或進出互為反運算', () => {
    const b = createBoard()
    const h = emptyHash()
    const seq: Array<[number, number, typeof BLACK | typeof WHITE]> = [
      [7, 7, BLACK],
      [8, 8, WHITE],
      [3, 12, BLACK],
      [0, 0, WHITE],
    ]
    for (const [x, y, c] of seq) {
      set(b, x, y, c)
      xorStone(h, idx(x, y), c)
    }
    const full = hashBoard(b)
    expect(h).toEqual(full)
    // 移除一子再放回 → hash 不變
    xorStone(h, idx(3, 12), BLACK)
    xorStone(h, idx(3, 12), BLACK)
    expect(h).toEqual(full)
    // 不同盤面 hash 不同（機率性，但固定 seed 下是確定的）
    xorStone(h, idx(5, 5), BLACK)
    expect(hashKey(h)).not.toBe(hashKey(full))
  })

  it('落子順序不同、盤面相同 → hash 相同', () => {
    const h1 = emptyHash()
    xorStone(h1, idx(1, 1), BLACK)
    xorStone(h1, idx(2, 2), WHITE)
    const h2 = emptyHash()
    xorStone(h2, idx(2, 2), WHITE)
    xorStone(h2, idx(1, 1), BLACK)
    expect(h1).toEqual(h2)
  })
})
