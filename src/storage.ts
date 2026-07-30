// localStorage 持久化（key 一律帶版本號，系列慣例）。
// 解析全部包 try/catch：壞資料回 fallback，不炸頁面。
import type { Rule } from './engine/types.ts'

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as T
    if (Array.isArray(fallback)) return Array.isArray(parsed) ? parsed : fallback
    if (typeof parsed !== 'object' || parsed === null) return fallback
    return { ...fallback, ...parsed }
  } catch {
    return fallback
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // 私密模式/滿容量：靜默略過
  }
}

// ---- 對弈設定 ----------------------------------------------------------
/** 對弈模式：free＝自由對弈（原行為）、rif＝RIF 正式規約（規則固定連珠）。 */
export type PlayMode = 'free' | 'rif'

export interface Settings {
  rule: Rule
  level: 1 | 2 | 3 | 4
  player: 'black' | 'white'
  showForbidden: boolean
  /** 舊資料無此欄位 → load 的 merge fallback 補 'free'，向下相容。 */
  mode: PlayMode
}
const SETTINGS_KEY = 'gomoku-dojo-settings-v1'
export const loadSettings = (): Settings =>
  load<Settings>(SETTINGS_KEY, {
    rule: 'renju',
    level: 2,
    player: 'black',
    showForbidden: true,
    mode: 'free',
  })
export const saveSettings = (s: Settings): void => save(SETTINGS_KEY, s)

// ---- 戰績（分規則 × 難度）----------------------------------------------
export interface StatLine {
  win: number
  loss: number
  draw: number
}
export type Stats = Record<string, StatLine> // key: `${rule}-L${level}`
const STATS_KEY = 'gomoku-dojo-stats-v1'
export const statKey = (rule: Rule, level: number): string => `${rule}-L${level}`
export const loadStats = (): Stats => load<Stats>(STATS_KEY, {})
export function recordOutcome(rule: Rule, level: number, outcome: keyof StatLine): void {
  const stats = loadStats()
  const key = statKey(rule, level)
  const line = stats[key] ?? { win: 0, loss: 0, draw: 0 }
  line[outcome]++
  stats[key] = line
  save(STATS_KEY, stats)
}

// ---- 棋譜庫（對局結束自動存，上限 60）----------------------------------
export interface SavedGame {
  id: string
  ts: number
  rule: Rule
  level: number
  /** 玩家最終執色（規約換邊後以換完的執色計，戰績同理）。 */
  player: 'black' | 'white'
  outcome: 'win' | 'loss' | 'draw'
  reason: string
  record: string
  /** 對弈模式（舊資料無此欄位＝自由對弈）。 */
  mode?: PlayMode
}
const RECORDS_KEY = 'gomoku-dojo-records-v1'
export const loadSavedGames = (): SavedGame[] => load<SavedGame[]>(RECORDS_KEY, [])
export function saveGame(g: Omit<SavedGame, 'id' | 'ts'>): void {
  const list = loadSavedGames()
  const ts = Date.now()
  list.unshift({ ...g, id: `g${ts}`, ts })
  if (list.length > 60) list.length = 60
  save(RECORDS_KEY, list)
}
export function deleteGame(id: string): void {
  save(
    RECORDS_KEY,
    loadSavedGames().filter((g) => g.id !== id),
  )
}

// ---- 題庫進度＋錯題本（連對 2 次移除）----------------------------------
export interface PuzzleProgress {
  /** 已通關（值 = 首次通關 timestamp）。 */
  solved: Record<string, number>
  /** 錯題本：streak = 之後「無錯通關」連對次數，達 2 移除。 */
  wrong: Record<string, { streak: number }>
}
const PUZZLE_KEY = 'gomoku-dojo-puzzles-v1'
export const loadPuzzleProgress = (): PuzzleProgress =>
  load<PuzzleProgress>(PUZZLE_KEY, { solved: {}, wrong: {} })

/** 一次作答結束：missed = 本次有判錯或看過解答。 */
export function recordPuzzleAttempt(id: string, solved: boolean, missed: boolean): void {
  const p = loadPuzzleProgress()
  if (solved && !p.solved[id]) p.solved[id] = Date.now()
  if (missed) {
    p.wrong[id] = { streak: 0 } // 出錯 → 進錯題本 / 連對歸零
  } else if (solved && p.wrong[id]) {
    const streak = p.wrong[id].streak + 1
    if (streak >= 2) delete p.wrong[id] // 連對 2 次 → 出本
    else p.wrong[id] = { streak }
  }
  save(PUZZLE_KEY, p)
}
