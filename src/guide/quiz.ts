// 打點複習（#/guide）的純邏輯：解析指南註記、決定要標哪些點、對稱判定、評分。
//
// 資料：《漱星閣開局指南》2026.4.3 版（中國「漱星閣」群組整理），每題＝開局＋白 4，
// 另有《玄》棋譜庫（名人林書玄整理，加密在 public/xuan/xuan.vault、解開後同格式＋grades；見 src/renlib/vault.ts）。
// 棋盤照 PDF 原方位。打點標籤（scripts/parse-opening-guide.mjs 解析）：
//   win  aN（綠）＝黑必勝　winq aN?＝不確定的必勝　bal 純數字 N＝評價見註記
//   near cN?（橘）＝白近勝　lose cN（紅）＝黑敗；prime＝N' 那一套（近似對稱盤面的另一側）
// 例：寒預註記「6打黑胜7打偏黑8打偏白9打白近胜其余黑败」→ 黑優點＝a1～a6＋7 共 7 個。

export type LabelKind = 'win' | 'winq' | 'bal' | 'near' | 'lose'
/** [x, y, 類別, 名次, 是否 ' 那一套] */
export type GuideLabel = [number, number, LabelKind, number, 0 | 1]

export interface GuideItem {
  page: number
  opening: string
  /** 變化名（繁體），如「寒預」。 */
  name: string
  /** 右欄註記原文（簡體），如「6打黑胜7打偏黑…」。 */
  notes: string
  /** 黑必勝點數（不同名次數）；< 10＝防十打。 */
  win: number
  viable: boolean
  /** 指南自己也沒把握的變化（生死局？／有 aN?）。 */
  hard: boolean
  /** 前四手 [x, y]（PDF 原方位）。 */
  stones: [number, number][]
  labels: GuideLabel[]
  /** 《玄》（林書玄整理）才有：每個 label 的原始評等（A1、D!、G?），與 labels 同序。
   *  有 grades 時評價直接看字母（A～C 黑優、D 均勢、E～G 白優），不看 notes。 */
  grades?: string[]
  src?: 'xuan'
}

export type NoteCat = 'black' | 'equal' | 'white'
export interface NoteEval {
  cat: NoteCat
  /** 原文評價，如「偏黑」「56%」。 */
  text: string
}

// 用詞：黑胜／黑近胜／黑优／偏黑…→黑優；平衡、沒寫哪方的「有望胜」→平衡；其餘白…→白優；
// 百分比（黑勝率）≥55 黑優、≤45 白優、其間平衡（指南有「7打56%」「4打51%」這種寫法）。
const NOTE_RE =
  /(\d+)(?:-(\d+))?('?)\s*打?\s*(黑胜|黑必胜|黑近胜|黑有望胜|黑大优|黑优|黑小优|偏黑|平衡|偏白|白小优|白优|白大优|白近胜|白有望胜|白胜|黑败|有望胜|\d+%)/g
const BLACK_WORDS = /^(黑胜|黑必胜|黑近胜|黑有望胜|黑大优|黑优|黑小优|偏黑)$/

/** 註記 → 每個名次（含 ' 那一套，key 如 "6"、"6'"）的評價。 */
export function parseNotes(notes: string): Map<string, NoteEval> {
  const m = new Map<string, NoteEval>()
  for (const t of notes.matchAll(NOTE_RE)) {
    const a = +t[1]
    const b = t[2] ? +t[2] : a
    const prime = !!t[3]
    const j = t[4]
    const pct = j.endsWith('%') ? parseInt(j, 10) : null
    const cat: NoteCat =
      pct !== null
        ? pct >= 55
          ? 'black'
          : pct <= 45
            ? 'white'
            : 'equal'
        : BLACK_WORDS.test(j)
          ? 'black'
          : j === '平衡' || j === '有望胜'
            ? 'equal'
            : 'white'
    for (let r = a; r <= b; r++) m.set(`${r}${prime ? "'" : ''}`, { cat, text: j })
  }
  return m
}

/** 要標的點：win＝只黑必勝；black＝黑優（＋註記偏黑等，預設）；notlose＝不輸（＋平衡）。 */
export type TargetMode = 'win' | 'black' | 'notlose'

/** 玄的評等字母 → 類別：A 黑必勝、B 黑大優、C 黑優 → 黑優；D 均勢 → 平衡；E～G → 白優。 */
export const gradeCat = (g: string): NoteCat => ('ABC'.includes(g[0]) ? 'black' : g[0] === 'D' ? 'equal' : 'white')

export function labelEval(item: GuideItem, l: GuideLabel, notes = parseNotes(item.notes)): NoteCat {
  if (item.grades) return gradeCat(item.grades[item.labels.indexOf(l)])
  const [, , kind, rank, prime] = l
  if (kind === 'win' || kind === 'winq') return 'black'
  if (kind === 'near' || kind === 'lose') return 'white'
  return notes.get(`${rank}${prime ? "'" : ''}`)?.cat ?? 'equal'
}

export function targetsOf(item: GuideItem, mode: TargetMode): GuideLabel[] {
  const notes = parseNotes(item.notes)
  return item.labels.filter((l) => {
    const [, , kind] = l
    if (kind === 'win' || kind === 'winq') return true
    if (mode === 'win') return false
    const cat = labelEval(item, l, notes)
    return cat === 'black' || (mode === 'notlose' && cat === 'equal')
  })
}

// ---- 對稱：前四手（含顏色）在 8 個盤面對稱下不變的那些變換——標在鏡像點也算對 ----
type Sym = (x: number, y: number) => [number, number]
const SYMS: Sym[] = [
  (x, y) => [x, y],
  (x, y) => [14 - x, y],
  (x, y) => [x, 14 - y],
  (x, y) => [14 - x, 14 - y],
  (x, y) => [y, x],
  (x, y) => [14 - y, 14 - x],
  (x, y) => [14 - y, x],
  (x, y) => [y, 14 - x],
]
export function stabilizer(stones: [number, number][]): Sym[] {
  const key = (st: [number, number][]) =>
    st
      .map(([x, y], i) => `${x},${y},${i % 2}`)
      .sort()
      .join(';')
  const k0 = key(stones)
  return SYMS.filter((f) => key(stones.map(([x, y]) => f(x, y))) === k0)
}

export interface GradeResult {
  hit: GuideLabel[]
  miss: GuideLabel[]
  wrong: [number, number][]
  perfect: boolean
}

/** 評分：每個目標點要被標到（或標在其對稱等價點）；標到非目標點算多標。 */
export function grade(item: GuideItem, mode: TargetMode, marks: [number, number][]): GradeResult {
  const tg = targetsOf(item, mode)
  const syms = stabilizer(item.stones)
  const eq = (a: [number, number], b: [number, number]) =>
    syms.some((f) => {
      const [x, y] = f(a[0], a[1])
      return x === b[0] && y === b[1]
    })
  const hit: GuideLabel[] = []
  const miss: GuideLabel[] = []
  for (const t of tg) (marks.some((m) => eq(m, [t[0], t[1]])) ? hit : miss).push(t)
  const wrong = marks.filter((m) => !tg.some((t) => eq(m, [t[0], t[1]])))
  return { hit, miss, wrong, perfect: miss.length === 0 && wrong.length === 0 }
}

/** 指南用字（簡體）→ 繁體顯示（註記用）。 */
const T2: Record<string, string> = { 胜: '勝', 余: '餘', 败: '敗', 优: '優', 恒: '恆', 银: '銀', 决: '決', 准: '準' }
export const tradText = (s: string): string => [...s].map((c) => T2[c] ?? c).join('')

// ---- 分兩色標（國手 2026-10-14：除了黑優也要記平衡點——比賽最常出現的就是這些）----
export type MarkCat = 'black' | 'equal'
export interface CatMark {
  x: number
  y: number
  cat: MarkCat
}

/** 黑優點（黑必勝＋偏黑等）與平衡點分開列。 */
export function targetsSplit(item: GuideItem): { black: GuideLabel[]; equal: GuideLabel[] } {
  const notes = parseNotes(item.notes)
  const black: GuideLabel[] = []
  const equal: GuideLabel[] = []
  for (const l of item.labels) {
    const cat = labelEval(item, l, notes)
    if (cat === 'black') black.push(l)
    else if (cat === 'equal' && l[2] === 'bal') equal.push(l)
  }
  return { black, equal }
}

export interface SplitGradeResult {
  hit: { label: GuideLabel; cat: MarkCat }[]
  miss: { label: GuideLabel; cat: MarkCat }[]
  /** 位置對、顏色標反（want＝應標的類別）。 */
  swapped: { label: GuideLabel; want: MarkCat }[]
  wrong: [number, number][]
  perfect: boolean
}

/** 分兩色評分：每個目標點要被同類別的標記標到（或其對稱等價點）。 */
export function gradeSplit(item: GuideItem, marks: CatMark[]): SplitGradeResult {
  const { black, equal } = targetsSplit(item)
  const syms = stabilizer(item.stones)
  const eq = (m: CatMark, l: GuideLabel) =>
    syms.some((f) => {
      const [x, y] = f(m.x, m.y)
      return x === l[0] && y === l[1]
    })
  const hit: SplitGradeResult['hit'] = []
  const miss: SplitGradeResult['miss'] = []
  const swapped: SplitGradeResult['swapped'] = []
  const all: [GuideLabel, MarkCat][] = [...black.map((l) => [l, 'black'] as [GuideLabel, MarkCat]), ...equal.map((l) => [l, 'equal'] as [GuideLabel, MarkCat])]
  for (const [l, cat] of all) {
    const ms = marks.filter((m) => eq(m, l))
    if (ms.some((m) => m.cat === cat)) hit.push({ label: l, cat })
    else if (ms.length > 0) swapped.push({ label: l, want: cat })
    else miss.push({ label: l, cat })
  }
  const wrong = marks.filter((m) => !all.some(([l]) => eq(m, l))).map((m) => [m.x, m.y] as [number, number])
  return { hit, miss, swapped, wrong, perfect: miss.length === 0 && swapped.length === 0 && wrong.length === 0 }
}
