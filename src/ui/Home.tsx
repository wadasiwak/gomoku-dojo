// 首頁：三大入口＋戰績/進度摘要。
import { loadStats, loadPuzzleProgress, loadSavedGames } from '../storage.ts'
import { PUZZLES } from '../puzzles/index.ts'
import { navigate } from '../router.ts'

export default function Home() {
  const stats = loadStats()
  const total = Object.values(stats).reduce(
    (a, s) => ({ win: a.win + s.win, loss: a.loss + s.loss, draw: a.draw + s.draw }),
    { win: 0, loss: 0, draw: 0 },
  )
  const games = total.win + total.loss + total.draw
  const progress = loadPuzzleProgress()
  const solved = PUZZLES.filter((p) => progress.solved[p.id]).length
  const wrongCount = Object.keys(progress.wrong).length
  const savedCount = loadSavedGames().length

  return (
    <div className="page">
      <div className="page-head">
        <h1>五子棋道場</h1>
        <p className="muted">
          連珠（禁手）與無禁手雙軌：AI 對弈、VCF 題庫闖關、棋譜重播。
          所有計算都在你的瀏覽器完成。
        </p>
      </div>
      <div className="home-grid">
        <button className="entry-card" onClick={() => navigate('play')}>
          <span className="entry-icon">⚫</span>
          <h2>對弈</h2>
          <p>四級 AI、規則與先後手自選；連珠模式即時標記黑禁手點。</p>
          <p className="entry-stat">
            {games > 0 ? (
              <>
                戰績 {total.win} 勝 {total.loss} 敗 {total.draw} 和
              </>
            ) : (
              '還沒下過——來一局'
            )}
          </p>
        </button>
        <button className="entry-card" onClick={() => navigate('puzzles')}>
          <span className="entry-icon">🧩</span>
          <h2>題庫闖關</h2>
          <p>VCF 連續衝四 {PUZZLES.length} 題，引擎逐手驗證，另一條殺法也算對。</p>
          <p className="entry-stat">
            進度 {solved}/{PUZZLES.length}
            {wrongCount > 0 ? `　錯題本 ${wrongCount}` : ''}
          </p>
        </button>
        <button className="entry-card" onClick={() => navigate('records')}>
          <span className="entry-icon">📜</span>
          <h2>棋譜重播</h2>
          <p>對局自動存檔，前進後退逐手看；停在任一手可岔出變化自由研棋。</p>
          <p className="entry-stat">已存 {savedCount} 局</p>
        </button>
        <button className="entry-card" onClick={() => navigate('study')}>
          <span className="entry-icon">🔬</span>
          <h2>擺譜研究</h2>
          <p>自由擺子建局再試下，隨時按「AI 建議」看引擎這手會下哪。</p>
          <p className="entry-stat">研究工具</p>
        </button>
      </div>
      <p className="home-foot">
        <a href="#/rules">連珠禁手是什麼？三型速覽 →</a>
      </p>
    </div>
  )
}
