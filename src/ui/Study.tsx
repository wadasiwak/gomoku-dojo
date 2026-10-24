// 擺譜研究：照打譜習慣，點棋盤依序一黑一白落子（棋子編號＝手順），右鍵或「退一手」
// 退回；隨時按「Rapfi 分析」。研究的譜可存檔（取名）、日後從清單開啟或覆蓋更新。
//
// 國手 2026-10-13 回饋後簡化：拿掉輪流/黑子/白子/清除工具、「接下來輪誰」與
// 「擺子／試下」兩段切換——打譜本來就一黑一白，手順即真實順序，Rapfi 直接吃
// moves 形式（Rapfi 把棋子順序當手順，見 analysis/protocol.ts boardToStones 註解）。
// 規則面沿用對弈的 Game：每手即時判五連/長連；連珠黑踩禁手判負；可開禁手點 ✕。
import { useEffect, useMemo, useRef, useState } from 'react'
import Board from './Board.tsx'
import ImportBox from './ImportBox.tsx'
import RapfiPanel from './RapfiPanel.tsx'
import { EngineClient } from '../engine/client.ts'
import { Game } from '../engine/game.ts'
import { parseRecord, serializeRecord } from '../engine/record.ts'
import { remainingPv, type PvAnchor } from './pvFollow.ts'
import {
  loadPvShow,
  savePvShow,
  loadStudies,
  addStudy,
  updateStudy,
  deleteStudy,
  type SavedStudy,
} from '../storage.ts'
import { BLACK, type Pos, type Rule } from '../engine/types.ts'
import { t, useT } from '../i18n/index.ts'

const KIND_LABEL: Record<string, string> = {
  overline: '長連',
  'double-four': '四四',
  'double-three': '三三',
}

const RESULT_TEXT: Record<string, string> = {
  five: '連成五',
  overline: '長連',
  forbidden: '黑踩禁手',
}

/** 預設存檔名：「研究 10/13 22:55」。 */
const defaultName = (): string =>
  t('研究 {time}', {
    time: new Date().toLocaleString('zh-TW', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
      hour12: false,
    }),
  })

export default function Study({ record }: { record?: string }) {
  const t = useT()
  const clientRef = useRef<EngineClient | null>(null)
  if (!clientRef.current) clientRef.current = new EngineClient()
  const client = clientRef.current
  useEffect(() => () => clientRef.current?.dispose(), [])

  // #/study/<棋譜>：把棋譜（開局圖鑑、匯入、存檔）鋪成初始手順。非法棋譜靜默忽略。
  const preset = record ? parseRecord(record) : null

  const [rule, setRule] = useState<Rule>(preset?.rule ?? 'renju')
  const [moves, setMoves] = useState<Pos[]>(() => preset?.moves ?? [])
  const [showFb, setShowFb] = useState(true)
  /** Rapfi 建議路線錨點（照著下會一路顯示，偏離自動收掉；見 pvFollow.ts）。 */
  const [pvAnchor, setPvAnchor] = useState<PvAnchor | null>(null)
  const [pvShow, setPvShow] = useState(loadPvShow)
  const [forbidden, setForbidden] = useState<{ index: number; kind: string }[]>([])
  // 存檔
  const [studies, setStudies] = useState<SavedStudy[]>(loadStudies)
  /** 目前盤面是從哪份存檔開啟的（可覆蓋更新）；null＝新譜。 */
  const [loadedId, setLoadedId] = useState<string | null>(null)
  const [saveName, setSaveName] = useState('')
  const [saveMsg, setSaveMsg] = useState<string | null>(null)

  // 逐手重放（非法手＝棋譜壞掉，只保留合法前綴）
  const game = useMemo(() => {
    const g = new Game(rule)
    for (const m of moves) if (!g.play(m.x, m.y)) break
    return g
  }, [rule, moves])
  const ongoing = game.result.kind === 'ongoing'
  const positionKey = `${rule}|${Array.from(game.board).join('')}`
  /** 尚未走的建議路線（盤面偏離就是空的）。 */
  const pvLine = remainingPv(pvAnchor, game.board)
  const recordStr = serializeRecord({ rule, moves: game.moves })

  // 連珠＋黑手番＋開關開 → 全盤禁手點標記（走 Worker）。
  useEffect(() => {
    let cancelled = false
    if (rule === 'renju' && showFb && ongoing && game.toMove === BLACK) {
      client.forbiddenPoints(game.board).then((pts) => {
        if (!cancelled) setForbidden(pts)
      })
    } else {
      setForbidden([])
    }
    return () => {
      cancelled = true
    }
  }, [client, rule, showFb, ongoing, game])

  const onCell = (x: number, y: number) => {
    if (!game.canPlay(x, y)) return
    setMoves((m) => [...m, { x, y }])
    setSaveMsg(null)
  }

  /** 右鍵／退一手（建議路線不清：悔回去還在路線上就繼續顯示）。 */
  const stepBack = () => {
    setMoves((m) => m.slice(0, -1))
    setSaveMsg(null)
  }

  /** 開啟存檔：就地載入（不走路由——同一份譜再開一次路由不會變）。 */
  const openStudy = (s: SavedStudy) => {
    const rec = parseRecord(s.record)
    if (!rec) return
    setRule(rec.rule)
    setMoves(rec.moves)
    setPvAnchor(null)
    setLoadedId(s.id)
    setSaveName(s.name)
    setSaveMsg(t('已開啟「{name}」', { name: s.name }))
  }

  const saveNew = () => {
    const name = saveName.trim() || defaultName()
    const item = addStudy(name, recordStr)
    setStudies(loadStudies())
    setLoadedId(item.id)
    setSaveName(name)
    setSaveMsg(t('已存檔「{name}」（{n} 手）', { name, n: game.moves.length }))
  }

  const saveOver = () => {
    if (!loadedId) return
    const name = saveName.trim() || defaultName()
    updateStudy(loadedId, name, recordStr)
    setStudies(loadStudies())
    setSaveName(name)
    setSaveMsg(t('已更新「{name}」（{n} 手）', { name, n: game.moves.length }))
  }

  const remove = (s: SavedStudy) => {
    if (!confirm(t('刪除存檔「{name}」？', { name: s.name }))) return
    deleteStudy(s.id)
    setStudies(loadStudies())
    if (loadedId === s.id) setLoadedId(null)
  }

  const statusText =
    game.result.kind === 'win'
      ? t('{c}勝（{reason}）', {
          c: game.result.winner === BLACK ? t('黑') : t('白'),
          reason: RESULT_TEXT[game.result.reason] ? t(RESULT_TEXT[game.result.reason]) : game.result.reason,
        })
      : game.result.kind === 'draw'
        ? t('和局')
        : t('輪{c}（第 {n} 手）', { c: game.toMove === BLACK ? t('黑') : t('白'), n: game.moves.length + 1 })

  const loaded = loadedId ? studies.find((s) => s.id === loadedId) : undefined

  return (
    <div className="page play-page">
      <div className="board-col">
        <p className={`status${ongoing ? '' : ' final'}`}>
          <b>{statusText}</b>
          <span className="muted">　{rule === 'renju' ? t('連珠') : t('無禁手')}</span>
          {forbidden.length > 0 && <span className="fb-note">　✕ {t('黑禁手點')}</span>}
        </p>
        <Board
          board={game.board}
          lastMove={game.moves[game.moves.length - 1] ?? null}
          numbered={game.moves}
          pvStart={game.moves.length + 1}
          onRightClick={stepBack}
          pv={pvShow > 0 ? pvLine.slice(0, pvShow) : pvLine}
          forbidden={forbidden.map((f) => ({
            x: f.index % 15,
            y: Math.floor(f.index / 15),
            kind: KIND_LABEL[f.kind] ? t(KIND_LABEL[f.kind]) : f.kind,
          }))}
          onCell={onCell}
          disabled={!ongoing}
          ariaLabel={t('擺譜棋盤')}
        />
      </div>
      <aside className="panel">
        <h2>{t('擺譜')}</h2>
        <p className="muted small">{t('點棋盤依序一黑一白落子，棋子編號＝手順；右鍵（或「退一手」）退回。')}</p>
        <label>
          {t('規則')}
          <select
            value={rule}
            onChange={(e) => {
              setRule(e.target.value as Rule)
              setPvAnchor(null) // 規則變了，建議路線不再適用
            }}
            aria-label={t('規則模式')}
          >
            <option value="renju">{t('連珠（黑有禁手）')}</option>
            <option value="gomoku">{t('無禁手五子棋')}</option>
          </select>
        </label>
        {rule === 'renju' && (
          <label className="row">
            <input type="checkbox" checked={showFb} onChange={(e) => setShowFb(e.target.checked)} />
            {t('顯示黑禁手點 ✕')}
          </label>
        )}
        <div className="btn-row">
          <button className="btn" onClick={stepBack} disabled={moves.length === 0}>
            {t('退一手')}
          </button>
          <button
            className="btn"
            onClick={() => {
              setMoves([])
              setLoadedId(null)
              setSaveName('')
              setSaveMsg(null)
            }}
            disabled={moves.length === 0}
          >
            {t('清空盤面')}
          </button>
        </div>

        <RapfiPanel
          buildInput={() => ({ moves: game.moves })}
          rule={rule}
          positionKey={pvLine.length > 0 && pvAnchor ? pvAnchor.key : positionKey}
          toMoveLabel={game.toMove === BLACK ? t('黑') : t('白')}
          disabled={!ongoing}
          pvShow={pvShow}
          onPvShow={(n) => {
            setPvShow(n)
            savePvShow(n)
          }}
          onResult={(a, key) =>
            setPvAnchor({ root: Uint8Array.from(game.board), line: a.pv, color: game.toMove, key })
          }
        />

        <h2>{t('存檔')}</h2>
        <div className="save-row">
          <input
            type="text"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder={defaultName()}
            aria-label={t('存檔名稱')}
            maxLength={40}
          />
        </div>
        <div className="btn-row">
          <button className="btn primary" onClick={saveNew} disabled={moves.length === 0}>
            {t('存成新檔')}
          </button>
          {loaded && (
            <button className="btn" onClick={saveOver} disabled={moves.length === 0}>
              {t('更新「{name}」', { name: loaded.name })}
            </button>
          )}
        </div>
        {saveMsg && <p className="msg ok">{saveMsg}</p>}
        {studies.length > 0 && (
          <ul className="study-list" aria-label={t('已存的研究譜')}>
            {studies.map((s) => (
              <li key={s.id} className={s.id === loadedId ? 'current' : ''}>
                <button className="study-open" onClick={() => openStudy(s)}>
                  <span>{s.name}</span>
                  <span className="muted small">
                    {t('{n} 手', { n: Math.ceil((s.record.split(':')[1]?.length ?? 0) / 2) })} ·{' '}
                    {new Date(s.ts).toLocaleString('zh-TW', {
                      month: 'numeric',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                    })}
                  </span>
                </button>
                <button className="btn small-btn" aria-label={t('刪除 {name}', { name: s.name })} onClick={() => remove(s)}>
                  {t('刪除')}
                </button>
              </li>
            ))}
          </ul>
        )}

        <h2>{t('匯入棋譜')}</h2>
        <p className="muted small">{t('貼上本站棋譜或座標序列（如 h8 i9 g9），驗證後鋪成擺譜手順。')}</p>
        <ImportBox target="study" />
      </aside>
    </div>
  )
}
