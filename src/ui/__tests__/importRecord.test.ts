// 匯入解析器容錯全路徑：分隔符/大小寫、行號方向、本站棋譜 passthrough、
// 逐手合法性（重複/越界/禁手判負/終局後多餘著手）、r2 規約一致性。
import { describe, expect, it } from 'vitest'
import { parseImport } from '../importRecord.ts'

/** 雙活三前置（e2e 同款）：黑 (5,7)(6,7)(7,5)(7,6)、白 (0,0)(1,0)(2,0)(3,0)，
 *  下一手黑 (7,7)=H8 踩三三禁手。座標序列寫法（行 1 在最下）。 */
const FORBIDDEN_SEQ = 'f8 a15 g8 b15 h10 c15 h9 d15 h8'

describe('parseImport 通用座標序列', () => {
  it('容忍大小寫、逗號/頓號/分號/空白/換行分隔', () => {
    for (const s of ['h8 i9 g9', 'H8,I9,G9', 'h8,\n I9 ；g9', 'H8、i9、G9', '  h8;i9;g9  ']) {
      const r = parseImport(s, 'renju')
      expect(r.ok, s).toBe(true)
      if (r.ok) expect(r.serialized).toBe('r1:hhiggg')
    }
  })

  it('行號 1 在最下：a1 → (0,14)、o15 → (14,0)', () => {
    const r = parseImport('a1 o15', 'renju')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.record.moves[0]).toEqual({ x: 0, y: 14 })
      expect(r.record.moves[1]).toEqual({ x: 14, y: 0 })
      expect(r.serialized).toBe('r1:aooa')
    }
  })

  it('gomoku 規則 → 序列化為 g1:', () => {
    const r = parseImport('h8 i9', 'gomoku')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.serialized).toBe('g1:hhig')
  })

  it('看不懂的 token 指出第幾手（列越界/行越界/格式）', () => {
    for (const [s, n] of [
      ['h8 z9', 2],
      ['p8', 1],
      ['h8 i9 h16', 3],
      ['h0', 1],
      ['h8 xyz', 2],
    ] as const) {
      const r = parseImport(s, 'renju')
      expect(r.ok, s).toBe(false)
      if (!r.ok) expect(r.error, s).toContain(`第 ${n} 手`)
    }
  })

  it('重複落子指出第幾手', () => {
    const r = parseImport('h8 i9 h8', 'renju')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain('第 3 手')
      expect(r.error).toContain('已有棋子')
    }
  })

  it('黑踩禁手判負可作為終局手匯入（照 Game 規則）', () => {
    const r = parseImport(FORBIDDEN_SEQ, 'renju')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.record.moves).toHaveLength(9)
  })

  it('禁手判負之後再有著手 → 指出第幾手非法', () => {
    const r = parseImport(`${FORBIDDEN_SEQ} a14`, 'renju')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('第 10 手')
  })

  it('同一序列在 gomoku 規則下無禁手、可以續下', () => {
    const r = parseImport(`${FORBIDDEN_SEQ} a14`, 'gomoku')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.record.moves).toHaveLength(10)
  })

  it('空輸入/純分隔符 → 提示先貼上', () => {
    for (const s of ['', '   ', '，，、', '\n\n']) {
      const r = parseImport(s, 'renju')
      expect(r.ok, JSON.stringify(s)).toBe(false)
      if (!r.ok) expect(r.error).toContain('請先貼上')
    }
  })
})

describe('parseImport 本站棋譜格式', () => {
  it('r1 passthrough（含大小寫與前後空白容錯）', () => {
    for (const s of ['r1:hhhgii', ' R1:HHHGII ', 'r1:hhhgii\n']) {
      const r = parseImport(s, 'gomoku') // 自帶規則，rule 參數應被忽略
      expect(r.ok, s).toBe(true)
      if (r.ok) {
        expect(r.serialized).toBe('r1:hhhgii')
        expect(r.record.rule).toBe('renju')
      }
    }
  })

  it('g1 保持 gomoku 規則', () => {
    const r = parseImport('g1:hhhgii', 'renju')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.record.rule).toBe('gomoku')
  })

  it('格式壞掉/重複落子 → 拒絕', () => {
    for (const s of ['r1:hhh', 'r1:hhhh', 'r3:hh', 'g2:hh']) {
      expect(parseImport(s, 'renju').ok, s).toBe(false)
    }
  })

  it('終局後仍有著手的 r1 棋譜 → 指出第幾手', () => {
    // 黑 (0,0)..(4,0) 第 9 手成五，第 10 手多餘
    const r = parseImport('r1:aaabbabbcacbdadbeafa', 'renju')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('第 10 手')
  })

  it('r2 規約棋譜：合法 passthrough、竄改拒絕', () => {
    const ok = parseImport('r2:hhigiijggill:oi7s0tgijj', 'renju')
    expect(ok.ok).toBe(true)
    if (ok.ok) {
      expect(ok.serialized).toBe('r2:hhigiijggill:oi7s0tgijj')
      expect(ok.record.rif?.openingId).toBe('i7')
    }
    const bad = parseImport('r2:hhigiijggill:od4s0tgijj', 'renju')
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error).toContain('規約')
  })
})
