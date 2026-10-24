// 棋譜庫：對局結束自動存檔的清單，點開重播、可刪除。
import { useState } from 'react'
import { loadSavedGames, deleteGame } from '../storage.ts'
import { navigate } from '../router.ts'
import { useT } from '../i18n/index.ts'

const OUTCOME_LABEL = { win: '勝', loss: '敗', draw: '和' } as const
const REASON_LABEL: Record<string, string> = {
  five: '五連',
  overline: '長連',
  forbidden: '踩禁手',
  resign: '認輸',
  time: '超時',
  draw: '和局',
}

export default function Records() {
  const t = useT()
  const [list, setList] = useState(loadSavedGames)

  return (
    <div className="page">
      <div className="page-head">
        <h1>{t('棋譜庫')}</h1>
        <p className="muted">{t('對局結束會自動存檔（最多 60 局）；點開即重播，連結可分享。')}</p>
      </div>
      {list.length === 0 && <p className="muted">{t('還沒有棋譜——去下一盤吧。')}</p>}
      <ul className="record-list">
        {list.map((g) => (
          <li key={g.id} className="record-item">
            <button className="record-open" onClick={() => navigate(`replay/${g.record}`)}>
              <span className={`badge ${g.outcome}`}>{t(OUTCOME_LABEL[g.outcome])}</span>
              <span>
                {g.mode === 'tara'
                  ? t('塔拉山口-10 · Rapfi {s}', { s: g.strength ? t(g.strength) : '' })
                  : `${g.rule === 'renju' ? t('連珠') : t('無禁手')} · ${g.level === 5 ? 'Rapfi' : `L${g.level}`}`}{' '}
                · {t('執{c}', { c: g.player === 'black' ? t('黑') : t('白') })} ·{' '}
                {REASON_LABEL[g.reason] ? t(REASON_LABEL[g.reason]) : g.reason}
              </span>
              <span className="muted small">
                {new Date(g.ts).toLocaleString('zh-TW', {
                  month: 'numeric',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                　{t('{n} 手', { n: Math.ceil(g.record.split(':')[1].length / 2) })}
              </span>
            </button>
            <button
              className="btn small-btn"
              aria-label={t('刪除棋譜')}
              onClick={() => {
                deleteGame(g.id)
                setList(loadSavedGames())
              }}
            >
              {t('刪除')}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
