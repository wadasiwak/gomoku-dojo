import { describe, it, expect } from 'vitest'
import {
  aiAcceptsDraw,
  canOfferDraw,
  DRAW_MIN_MOVES,
  DRAW_RETRY_MOVES,
  DRAW_REFUSE_RAPFI,
} from '../drawOffer.ts'

describe('canOfferDraw', () => {
  it('未滿最低手數不能提和', () => {
    expect(canOfferDraw(DRAW_MIN_MOVES - 1, null)).toBe(false)
    expect(canOfferDraw(DRAW_MIN_MOVES, null)).toBe(true)
  })
  it('被拒絕後要再下滿間隔手數才能再提', () => {
    const refusedAt = 64
    expect(canOfferDraw(refusedAt, refusedAt)).toBe(false)
    expect(canOfferDraw(refusedAt + DRAW_RETRY_MOVES - 1, refusedAt)).toBe(false)
    expect(canOfferDraw(refusedAt + DRAW_RETRY_MOVES, refusedAt)).toBe(true)
  })
})

describe('aiAcceptsDraw', () => {
  it('AI 沒有明顯優勢 → 接受', () => {
    expect(aiAcceptsDraw(40, DRAW_REFUSE_RAPFI)).toBe(true)
    expect(aiAcceptsDraw(0, DRAW_REFUSE_RAPFI)).toBe(true)
  })
  it('AI 落後 → 接受', () => {
    expect(aiAcceptsDraw(-300, DRAW_REFUSE_RAPFI)).toBe(true)
    expect(aiAcceptsDraw(-29990, DRAW_REFUSE_RAPFI)).toBe(true)
  })
  it('AI 明顯優勢或必勝 → 拒絕', () => {
    expect(aiAcceptsDraw(DRAW_REFUSE_RAPFI, DRAW_REFUSE_RAPFI)).toBe(false)
    expect(aiAcceptsDraw(420, DRAW_REFUSE_RAPFI)).toBe(false)
    expect(aiAcceptsDraw(29985, DRAW_REFUSE_RAPFI)).toBe(false)
  })
  it('拿不到評分 → 拒絕', () => {
    expect(aiAcceptsDraw(null, DRAW_REFUSE_RAPFI)).toBe(false)
  })
})
