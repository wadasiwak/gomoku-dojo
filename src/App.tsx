// App shell：hash routing + 頂欄導覽。原引擎 debug 頁已由正式對弈頁收編
// （禁手標記/AI/VCF 驗證都在對弈與題庫流程裡）。
import Home from './ui/Home.tsx'
import Play from './ui/Play.tsx'
import Puzzles from './ui/Puzzles.tsx'
import PuzzlePlay from './ui/PuzzlePlay.tsx'
import Replay from './ui/Replay.tsx'
import Records from './ui/Records.tsx'
import Study from './ui/Study.tsx'
import Rules from './ui/Rules.tsx'
import Openings from './ui/Openings.tsx'
import Resources from './ui/Resources.tsx'
import { RAPFI_ATTRIBUTION } from './analysis/rapfi.ts'
import { useRoute } from './router.ts'

const NAV = [
  { hash: '', label: '首頁', match: ['home'] },
  { hash: 'play', label: '對弈', match: ['play'] },
  { hash: 'puzzles', label: '題庫', match: ['puzzles', 'puzzle'] },
  { hash: 'openings', label: '開局', match: ['openings'] },
  { hash: 'records', label: '棋譜', match: ['records', 'replay'] },
  { hash: 'study', label: '擺譜', match: ['study'] },
  { hash: 'rules', label: '規則', match: ['rules'] },
  { hash: 'resources', label: '資源', match: ['resources'] },
]

// GPL 合規：RAPFI_ATTRIBUTION（單一真相字串）進 footer，原始碼部分轉成連結。
const RAPFI_URL = 'github.com/dhbloo/rapfi'
const [ATTR_TEXT] = RAPFI_ATTRIBUTION.split(RAPFI_URL)

export default function App() {
  const route = useRoute()

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#/">
          ⚫ 五子棋道場
        </a>
        <nav aria-label="主導覽">
          {NAV.map((n) => (
            <a
              key={n.hash}
              href={`#/${n.hash}`}
              className={n.match.includes(route.name) ? 'active' : ''}
            >
              {n.label}
            </a>
          ))}
        </nav>
      </header>
      <main>
        {route.name === 'home' && <Home />}
        {route.name === 'play' && <Play key={route.record ?? ''} record={route.record} />}
        {route.name === 'puzzles' && <Puzzles tab={route.tab} />}
        {route.name === 'puzzle' && <PuzzlePlay id={route.id} key={route.id} />}
        {route.name === 'replay' && <Replay record={route.record} />}
        {route.name === 'records' && <Records />}
        {route.name === 'study' && <Study key={route.record ?? ''} record={route.record} />}
        {route.name === 'rules' && <Rules />}
        {route.name === 'resources' && <Resources />}
        {route.name === 'openings' && <Openings sub={route.sub} />}
      </main>
      <footer>
        <p>
          © 2026 wadasiwak. All rights reserved.　引擎與題庫為本站原創；
          連珠規則本身為公有領域。
        </p>
        <p className="foot-attr">
          {ATTR_TEXT}
          <a href={`https://${RAPFI_URL}`} target="_blank" rel="noreferrer">
            {RAPFI_URL}
          </a>
          （未修改，獨立 WASM Worker 掛載）
        </p>
      </footer>
    </div>
  )
}
