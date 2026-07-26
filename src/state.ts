// Debug 頁的極簡對局狀態（zustand）。正式 UI 下一階段重做。
import { create } from 'zustand'
import type { Pos, Rule } from './engine/types.ts'

interface DojoState {
  rule: Rule
  moves: Pos[]
  play: (x: number, y: number) => void
  undo: () => void
  reset: (rule: Rule) => void
}

export const useDojo = create<DojoState>((set) => ({
  rule: 'renju',
  moves: [],
  play: (x, y) => set((s) => ({ moves: [...s.moves, { x, y }] })),
  undo: () => set((s) => ({ moves: s.moves.slice(0, -1) })),
  reset: (rule) => set({ rule, moves: [] }),
}))
