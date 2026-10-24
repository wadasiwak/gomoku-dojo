// 題庫列表：依難度分頁＋錯題本（連對 2 次出本）。
import { useMemo } from 'react'
import { PUZZLES, DIFF_LABEL, type Difficulty } from '../puzzles/index.ts'
import { loadPuzzleProgress } from '../storage.ts'
import { navigate } from '../router.ts'
import { useT } from '../i18n/index.ts'

const TABS: { key: string; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'easy', label: '初級' },
  { key: 'medium', label: '中級' },
  { key: 'hard', label: '高級' },
  { key: 'wrong', label: '錯題本' },
]

export default function Puzzles({ tab }: { tab: string }) {
  const t = useT()
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
        <h1>{t('題庫闖關（VCF 連續衝四）')}</h1>
        <p className="muted">
          {t('進度 {a}/{b}', { a: solvedCount, b: PUZZLES.length })}
          {wrongIds.length > 0 && <>　·　{t('錯題本 {n} 題（連對 2 次出本）', { n: wrongIds.length })}</>}
        </p>
      </div>
      <nav className="tabs" aria-label={t('題庫分頁')}>
        {TABS.map((tb) => (
          <button
            key={tb.key}
            className={`tab${tab === tb.key ? ' active' : ''}`}
            onClick={() => navigate(`puzzles/${tb.key}`)}
          >
            {t(tb.label)}
            {tb.key === 'wrong' && wrongIds.length > 0 ? `（${wrongIds.length}）` : ''}
          </button>
        ))}
      </nav>
      {list.length === 0 && (
        <p className="muted">{tab === 'wrong' ? t('錯題本是空的——太強了。') : t('沒有題目。')}</p>
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
                <span className={`badge ${p.difficulty}`}>{t(DIFF_LABEL[p.difficulty])}</span>
                <span className="pz-title">
                  {p.id}　{p.attacker === 'black' ? t('黑先') : t('白先')} · {t('VCF {n} 手', { n: p.vcfDepth })}
                </span>
                <span className="muted small">
                  {p.rule === 'renju' ? t('連珠') : t('無禁手')} · {t('{n} 子', { n: p.stones })}
                </span>
                <span className="pz-state">
                  {done ? '✓' : ''}
                  {wrong ? ` ↻${wrong.streak > 0 ? ` ${t('連對{n}', { n: wrong.streak })}` : ''}` : ''}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
