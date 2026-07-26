// 棋譜庫：對局結束自動存檔的清單，點開重播、可刪除。
import { useState } from 'react'
import { loadSavedGames, deleteGame } from '../storage.ts'
import { navigate } from '../router.ts'

const OUTCOME_LABEL = { win: '勝', loss: '敗', draw: '和' } as const
const REASON_LABEL: Record<string, string> = {
  five: '五連',
  overline: '長連',
  forbidden: '踩禁手',
  resign: '認輸',
  draw: '和局',
}

export default function Records() {
  const [list, setList] = useState(loadSavedGames)

  return (
    <div className="page">
      <div className="page-head">
        <h1>棋譜庫</h1>
        <p className="muted">對局結束會自動存檔（最多 60 局）；點開即重播，連結可分享。</p>
      </div>
      {list.length === 0 && <p className="muted">還沒有棋譜——去下一盤吧。</p>}
      <ul className="record-list">
        {list.map((g) => (
          <li key={g.id} className="record-item">
            <button className="record-open" onClick={() => navigate(`replay/${g.record}`)}>
              <span className={`badge ${g.outcome}`}>{OUTCOME_LABEL[g.outcome]}</span>
              <span>
                {g.rule === 'renju' ? '連珠' : '無禁手'} · L{g.level} · 執
                {g.player === 'black' ? '黑' : '白'} ·{' '}
                {REASON_LABEL[g.reason] ?? g.reason}
              </span>
              <span className="muted small">
                {new Date(g.ts).toLocaleString('zh-TW', {
                  month: 'numeric',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                　{Math.ceil(g.record.split(':')[1].length / 2)} 手
              </span>
            </button>
            <button
              className="btn small-btn"
              aria-label="刪除棋譜"
              onClick={() => {
                deleteGame(g.id)
                setList(loadSavedGames())
              }}
            >
              刪除
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
