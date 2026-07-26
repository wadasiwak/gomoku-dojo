// 題庫列表：依難度分頁＋錯題本（連對 2 次出本）。
import { useMemo } from 'react'
import { PUZZLES, DIFF_LABEL, type Difficulty } from '../puzzles/index.ts'
import { loadPuzzleProgress } from '../storage.ts'
import { navigate } from '../router.ts'

const TABS: { key: string; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'easy', label: '初級' },
  { key: 'medium', label: '中級' },
  { key: 'hard', label: '高級' },
  { key: 'wrong', label: '錯題本' },
]

export default function Puzzles({ tab }: { tab: string }) {
  const progress = useMemo(loadPuzzleProgress, [tab])
  const wrongIds = Object.keys(progress.wrong)

  const list =
    tab === 'wrong'
      ? PUZZLES.filter((p) => progress.wrong[p.id])
      : tab === 'all'
        ? PUZZLES
        : PUZZLES.filter((p) => p.difficulty === (tab as Difficulty))

  const solvedCount = PUZZLES.filter((p) => progress.solved[p.id]).length

  return (
    <div className="page">
      <div className="page-head">
        <h1>題庫闖關（VCF 連續衝四）</h1>
        <p className="muted">
          進度 {solvedCount}/{PUZZLES.length}
          {wrongIds.length > 0 && <>　·　錯題本 {wrongIds.length} 題（連對 2 次出本）</>}
        </p>
      </div>
      <nav className="tabs" aria-label="題庫分頁">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`tab${tab === t.key ? ' active' : ''}`}
            onClick={() => navigate(`puzzles/${t.key}`)}
          >
            {t.label}
            {t.key === 'wrong' && wrongIds.length > 0 ? `（${wrongIds.length}）` : ''}
          </button>
        ))}
      </nav>
      {list.length === 0 && (
        <p className="muted">{tab === 'wrong' ? '錯題本是空的——太強了。' : '沒有題目。'}</p>
      )}
      <ul className="puzzle-list">
        {list.map((p) => {
          const done = !!progress.solved[p.id]
          const wrong = progress.wrong[p.id]
          return (
            <li key={p.id}>
              <button
                className={`puzzle-card${done ? ' done' : ''}`}
                onClick={() => navigate(`puzzle/${p.id}`)}
              >
                <span className={`badge ${p.difficulty}`}>{DIFF_LABEL[p.difficulty]}</span>
                <span className="pz-title">
                  {p.id}　{p.attacker === 'black' ? '黑先' : '白先'} · VCF {p.vcfDepth} 手
                </span>
                <span className="muted small">
                  {p.rule === 'renju' ? '連珠' : '無禁手'} · {p.stones} 子
                </span>
                <span className="pz-state">
                  {done ? '✓' : ''}
                  {wrong ? ` ↻${wrong.streak > 0 ? ` 連對${wrong.streak}` : ''}` : ''}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
