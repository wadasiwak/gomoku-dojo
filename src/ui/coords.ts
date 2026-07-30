// 連珠慣例座標名：字母列（A–O，左→右）＋數字行（15..1，行 1 在最下）。
// 全站單一真相——匯入解析器（importRecord.ts）反向解析同一慣例，改動要對齊。
import type { Pos } from '../engine/types.ts'

/** 內部座標 → 連珠慣例座標名（A1 左下）。 */
export function coordName(p: Pos): string {
  return `${String.fromCharCode(65 + p.x)}${15 - p.y}`
}
