// 打點複習純邏輯：註記解析（含百分比、範圍、' 那一套）、目標三段、對稱判定、評分，
// 並對全部 249 題做資料完整性檢查（每個平衡類打點都要對得到註記評價）。
import { describe, expect, it } from 'vitest'
import { parseNotes, targetsOf, stabilizer, grade, type GuideItem } from '../quiz.ts'
import DATA from '../guide-data.json'

const ALL = DATA as unknown as GuideItem[]
const byName = (n: string) => ALL.find((v) => v.name === n)!

describe('parseNotes', () => {
  it('寒預：6 打黑勝、7 打偏黑、8 打偏白、9 打白近勝', () => {
    const m = parseNotes('6打黑胜7打偏黑8打偏白9打白近胜其余黑败')
    expect(m.get('6')?.cat).toBe('black')
    expect(m.get('7')?.cat).toBe('black')
    expect(m.get('8')?.cat).toBe('white')
    expect(m.get('9')?.cat).toBe('white')
  })
  it('範圍、百分比、撇號那一套', () => {
    const m = parseNotes("13-18打白近胜7打56%4打51%6'偏白8打36%")
    expect(m.get('15')?.cat).toBe('white')
    expect(m.get('7')?.cat).toBe('black')
    expect(m.get('4')?.cat).toBe('equal')
    expect(m.get("6'")?.cat).toBe('white')
    expect(m.get('8')?.cat).toBe('white')
  })
})

describe('targetsOf', () => {
  it('寒預：黑優 7 個（a1～a6＋偏黑的 7）、只黑必勝 6 個', () => {
    const v = byName('寒預')
    expect(targetsOf(v, 'black')).toHaveLength(7)
    expect(targetsOf(v, 'win')).toHaveLength(6)
  })
  it("寒通（近似對稱）：a3/a3' 是不同點、都要標；6 偏黑、6' 偏白", () => {
    const v = byName('寒通')
    const t = targetsOf(v, 'black').map((l) => `${l[3]}${l[4] ? "'" : ''}`)
    expect(t).toContain('3')
    expect(t).toContain("3'")
    expect(t).toContain('6')
    expect(t).not.toContain("6'")
  })
})

describe('stabilizer / grade', () => {
  it('寒預四子一直線（左右對稱）→ 標鏡像點也算對', () => {
    const v = byName('寒預')
    expect(stabilizer(v.stones).length).toBeGreaterThan(1)
    const f = stabilizer(v.stones)[1]
    const mirrored = targetsOf(v, 'black').map((l) => f(l[0], l[1]))
    expect(grade(v, 'black', mirrored).perfect).toBe(true)
  })
  it('漏標與多標分別回報', () => {
    const v = byName('寒預')
    const tg = targetsOf(v, 'black').map((l) => [l[0], l[1]] as [number, number])
    const r = grade(v, 'black', [...tg.slice(1), [0, 0]])
    expect(r.perfect).toBe(false)
    expect(r.miss).toHaveLength(1)
    expect(r.wrong).toEqual([[0, 0]])
  })
})

describe('資料完整性（249 題）', () => {
  it('題數、每題四子、標籤不壓子', () => {
    expect(ALL).toHaveLength(249)
    for (const v of ALL) {
      expect(v.stones).toHaveLength(4)
      for (const [x, y] of v.labels) expect(v.stones.some(([sx, sy]) => sx === x && sy === y)).toBe(false)
    }
  })
  it('每個平衡類打點都對得到註記評價', () => {
    const missing: string[] = []
    for (const v of ALL) {
      const n = parseNotes(v.notes)
      for (const [, , kind, rank, prime] of v.labels)
        if (kind === 'bal' && !n.has(`${rank}${prime ? "'" : ''}`)) missing.push(`${v.page}:${v.name} ${rank}`)
    }
    expect(missing).toEqual([])
  })
})
