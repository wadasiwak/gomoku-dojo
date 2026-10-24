// 首頁：三大入口＋戰績/進度摘要。
import { loadStats, loadPuzzleProgress, loadSavedGames } from '../storage.ts'
import { PUZZLES } from '../puzzles/index.ts'
import { navigate } from '../router.ts'
import { useT } from '../i18n/index.ts'

export default function Home() {
  const t = useT()
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
        <h1>{t('五子棋道場')}</h1>
        <p className="muted">{t('連珠（禁手）與無禁手雙軌：AI 對弈、VCF 題庫闖關、棋譜重播。所有計算都在你的瀏覽器完成。')}</p>
      </div>
      <div className="home-grid">
        <button className="entry-card" onClick={() => navigate('play')}>
          <span className="entry-icon">⚫</span>
          <h2>{t('對弈')}</h2>
          <p>{t('四級 AI、自由對弈或 RIF 正式規約（換邊＋兩打）；即時標記黑禁手點。')}</p>
          <p className="entry-stat">
            {games > 0 ? (
              t('戰績 {w} 勝 {l} 敗 {d} 和', { w: total.win, l: total.loss, d: total.draw })
            ) : (
              t('還沒下過——來一局')
            )}
          </p>
        </button>
        <button className="entry-card" onClick={() => navigate('tara')}>
          <span className="entry-icon">🏆</span>
          <h2>{t('名人賽特訓')}</h2>
          <p>{t('塔拉山口-10 開局對 Rapfi（交換／十打／最後選黑白），可開 30 分＋30 秒棋鐘。')}</p>
          <p className="entry-stat">{t('對手：Gomocup 冠軍級引擎')}</p>
        </button>
        <button className="entry-card" onClick={() => navigate('guide')}>
          <span className="entry-icon">📍</span>
          <h2>{t('打點複習')}</h2>
          <p>{t('《漱星閣開局指南》249 個＋《玄》979 個白 4 變化：在盤上標出黑優與平衡打點，對答案、錯題本複習。')}</p>
          <p className="entry-stat">{t('漱星閣群組／名人林書玄整理')}</p>
        </button>
        <button className="entry-card" onClick={() => navigate('lib')}>
          <span className="entry-icon">📚</span>
          <h2>{t('玄庫看譜')}</h2>
          <p>{t('名人林書玄整理的《玄》棋譜庫：26 開局一路點到最後的變化，評等 A～G 上色，庫外可接 Rapfi 研究。')}</p>
          <p className="entry-stat">{t('🔒 需密碼・名人林書玄整理')}</p>
        </button>
        <button className="entry-card" onClick={() => navigate('puzzles')}>
          <span className="entry-icon">🧩</span>
          <h2>{t('題庫闖關')}</h2>
          <p>{t('VCF 連續衝四 {n} 題，引擎逐手驗證，另一條殺法也算對。', { n: PUZZLES.length })}</p>
          <p className="entry-stat">
            {t('進度 {a}/{b}', { a: solved, b: PUZZLES.length })}
            {wrongCount > 0 ? `　${t('錯題本 {n}', { n: wrongCount })}` : ''}
          </p>
        </button>
        <button className="entry-card" onClick={() => navigate('records')}>
          <span className="entry-icon">📜</span>
          <h2>{t('棋譜重播')}</h2>
          <p>{t('對局自動存檔，前進後退逐手看；停在任一手可岔出變化自由研棋。')}</p>
          <p className="entry-stat">{t('已存 {n} 局', { n: savedCount })}</p>
        </button>
        <button className="entry-card" onClick={() => navigate('study')}>
          <span className="entry-icon">🔬</span>
          <h2>{t('擺譜研究')}</h2>
          <p>{t('自由擺子建局再試下，隨時按「AI 建議」看引擎這手會下哪。')}</p>
          <p className="entry-stat">{t('研究工具')}</p>
        </button>
        <button className="entry-card" onClick={() => navigate('openings')}>
          <span className="entry-icon">📖</span>
          <h2>{t('開局圖鑑')}</h2>
          <p>{t('RIF 26 珠型全收錄：直接／間接開局、主流優劣傾向與白話講解。')}</p>
          <p className="entry-stat">{t('26 珠型・猜名練習')}</p>
        </button>
      </div>
      <p className="home-foot">
        <a href="#/rules">{t('連珠禁手是什麼？三型速覽 →')}</a>
        　<a href="#/resources">{t('連珠資源站介紹 →')}</a>
      </p>
    </div>
  )
}
