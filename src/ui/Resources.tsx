// 資源頁：自撰介紹三個外部權威站並外連（僅介紹與連結、不轉載內容），
// 附「本站與外部資源的關係」聲明（開局書引擎自產、未使用 renju.net DB 內容上站、
// Rapfi GPL-3.0 致謝）。
interface Site {
  name: string
  org: string
  url: string
  desc: string
  tags: string[]
}

const SITES: Site[] = [
  {
    name: 'renju.net',
    org: 'RIF 國際連珠聯盟',
    url: 'https://www.renju.net/',
    desc:
      '連珠世界的官方樞紐：RIF 正式規則全文與 26 珠型定義、世界排名、國際賽事' +
      '紀錄，以及十五萬局以上的職業對局資料庫（下載授權為非商業、僅限離線研究）。' +
      '查權威規則與職業實戰，以這裡為準。',
    tags: ['官方規則', '對局資料庫', '世界排名'],
  },
  {
    name: '587.renju.org.tw',
    org: '台灣連珠推廣',
    url: 'http://587.renju.org.tw/',
    desc:
      '台灣本土的連珠推廣站：中文教學文章由淺入深，還有國內賽事公告與段位資訊。' +
      '想循中文教材入門、找同好或報名比賽，從這裡開始。',
    tags: ['中文教學', '賽事公告', '段位'],
  },
  {
    name: 'gomocalc.com',
    org: '線上 Rapfi 分析（五子棋計算器）',
    url: 'https://gomocalc.com/',
    desc:
      '瀏覽器裡直接用的強力分析工具，背後是 Gomocup 冠軍級的 Rapfi 引擎' +
      '（NNUE 評估）。本站「Rapfi 分析」掛載的就是同一顆引擎的 WASM 版；' +
      '需要更完整的分析介面（多變化、無限思考）可以去 gomocalc。',
    tags: ['引擎分析', 'Rapfi', '免安裝'],
  },
]

export default function Resources() {
  return (
    <div className="page">
      <div className="page-head">
        <h1>連珠資源</h1>
        <p className="muted">
          想往下鑽研的三個外部站：官方規則與職業對局、台灣中文教學與賽事、線上引擎分析。
          內容屬各站所有，本站僅介紹與連結。
        </p>
      </div>
      <div className="res-grid">
        {SITES.map((s) => (
          <section key={s.name} className="res-card">
            <h2>
              <a href={s.url} target="_blank" rel="noreferrer">
                {s.name} ↗
              </a>
            </h2>
            <p className="res-org">{s.org}</p>
            <p>{s.desc}</p>
            <div className="res-tags">
              {s.tags.map((t) => (
                <span key={t} className="badge">
                  {t}
                </span>
              ))}
            </div>
          </section>
        ))}
      </div>
      <section className="res-note">
        <h2>本站與外部資源的關係</h2>
        <p>
          本站的開局書與題庫皆由本站引擎自行計算產生，未使用 renju.net
          對局資料庫的內容上站（該資料庫授權為非商業且僅限離線使用）；
          外部網站的文章與棋譜屬原站所有，本站僅連結、不轉載。
        </p>
        <p>
          站內「Rapfi 分析」功能掛載未經修改的{' '}
          <a href="https://github.com/dhbloo/rapfi" target="_blank" rel="noreferrer">
            Rapfi
          </a>{' '}
          引擎（© dhbloo，GPL-3.0，自行編譯為 WASM）；本站的規則引擎與對弈 AI
          為獨立原創實作。
        </p>
      </section>
    </div>
  )
}
