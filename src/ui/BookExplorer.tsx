// 開局書檢視（隱藏頁 #/book，不進導覽列）：給棋手 survey 全部書內局面。
// 依 26 開局分組（前三手比對），每筆列出局面小盤＋建議手 hint 圈＋分數/深度。
// 分數為「行棋方視角」的 Rapfi 深算值；書最深收錄第 8 手局面（建議到第 9 手）。
import { useMemo, useState } from 'react'
import Board from './Board.tsx'
import { coordName } from './coords.ts'
import { createBoard } from '../engine/board.ts'
import { BLACK, WHITE, idx, type Pos } from '../engine/types.ts'
import { BOOK_ENTRIES, BOOK_SIZE, BOOK_SOURCE } from '../openings/index.ts'
import { findOpeningByMoves, OPENINGS, type Opening } from '../content/openings.ts'
import { useT } from '../i18n/index.ts'

interface Item {
  key: string
  moves: Pos[]
  suggest: Pos
  score: number
  depth: number
}

const decodeMoves = (s: string): Pos[] => {
  const out: Pos[] = []
  for (let i = 0; i + 1 < s.length; i += 2) {
    out.push({ x: s.charCodeAt(i) - 97, y: s.charCodeAt(i + 1) - 97 })
  }
  return out
}

function cropFor(moves: Pos[], suggest: Pos) {
  const xs = [...moves, suggest].map((p) => p.x)
  const ys = [...moves, suggest].map((p) => p.y)
  const pad = 2
  return {
    x0: Math.max(0, Math.min(...xs) - pad),
    y0: Math.max(0, Math.min(...ys) - pad),
    x1: Math.min(14, Math.max(...xs) + pad),
    y1: Math.min(14, Math.max(...ys) + pad),
  }
}

function EntryCard({ it }: { it: Item }) {
  const t = useT()
  const board = useMemo(() => {
    const b = createBoard()
    it.moves.forEach((m, i) => {
      b[idx(m.x, m.y)] = i % 2 === 0 ? BLACK : WHITE
    })
    return b
  }, [it])
  const toMove = it.moves.length % 2 === 0 ? t('黑') : t('白')
  return (
    <div className="book-item">
      <Board
        board={board}
        numbered={it.moves}
        hint={it.suggest}
        crop={cropFor(it.moves, it.suggest)}
        ariaLabel={t('書局面 {key}', { key: it.key || t('空盤') })}
      />
      <p className="small">
        {t('第 {n} 手局面 → 建議{c}', { n: it.moves.length, c: toMove })} <b>{coordName(it.suggest)}</b>
        <br />
        <span className="muted">
          {t('分數 {s}（行棋方視角）・深度 {d}', { s: it.score >= 0 ? `+${it.score}` : it.score, d: it.depth })}
        </span>
      </p>
    </div>
  )
}

export default function BookExplorer() {
  const t = useT()
  const [open, setOpen] = useState<string | null>(null)

  const { groups, byLen } = useMemo(() => {
    const items: Item[] = Object.entries(BOOK_ENTRIES).map(([key, e]) => {
      const moves = decodeMoves(key)
      const [sp] = decodeMoves(e.move)
      return { key, moves, suggest: sp, score: e.score, depth: e.depth }
    })
    const byLen = new Map<number, number>()
    for (const it of items) byLen.set(it.moves.length, (byLen.get(it.moves.length) ?? 0) + 1)

    const groups = new Map<string, { opening: Opening | null; items: Item[] }>()
    for (const it of items) {
      const op = it.moves.length >= 3 ? findOpeningByMoves(it.moves.slice(0, 3)) : null
      const gk = op ? op.id : '_other'
      if (!groups.has(gk)) groups.set(gk, { opening: op, items: [] })
      groups.get(gk)!.items.push(it)
    }
    for (const g of groups.values())
      g.items.sort((a, z) => a.moves.length - z.moves.length || a.key.localeCompare(z.key))
    return { groups, byLen }
  }, [])

  const ordered = [
    ...OPENINGS.filter((o) => groups.has(o.id)).map((o) => ({ gk: o.id, ...groups.get(o.id)! })),
    ...(groups.has('_other') ? [{ gk: '_other', ...groups.get('_other')! }] : []),
  ]
  const lenLine = [...byLen.entries()]
    .sort((a, z) => a[0] - z[0])
    .map(([n, c]) => t('{n} 手×{c}', { n, c }))
    .join(t('、'))

  return (
    <div className="page">
      <h1>{t('開局書檢視')}</h1>
      <p className="muted small">
        {t('隱藏頁（不在導覽列）。書由 {engine} {version}（{commit}）離線深算 {sec}s/局面產生，共', { engine: BOOK_SOURCE.engine, version: BOOK_SOURCE.version, commit: BOOK_SOURCE.commit, sec: BOOK_SOURCE.thinkTimeMs / 1000 })}{' '}
        <b>{BOOK_SIZE}</b>{' '}
        {t('局面；手數分布：{len}——最深為第 8 手局面，即建議到第 9 手。分數為行棋方視角；每筆建議手皆經本站引擎合法性雙驗。對局中 AI 的中局書手僅最高難度採用；規約兩打／擇打評值各難度皆用書值。', { len: lenLine })}
      </p>
      {ordered.map(({ gk, opening, items }) => (
        <details
          key={gk}
          open={open === gk}
          onToggle={(e) => {
            if ((e.target as HTMLDetailsElement).open) setOpen(gk)
          }}
        >
          <summary>
            <b>{opening ? `${t(opening.name)}（${t(opening.tendency)}）` : t('自由模式／其他')}</b>
            <span className="muted">　{t('{n} 局面', { n: items.length })}</span>
          </summary>
          {open === gk && (
            <div className="book-grid">
              {items.map((it) => (
                <EntryCard key={it.key} it={it} />
              ))}
            </div>
          )}
        </details>
      ))}
    </div>
  )
}
