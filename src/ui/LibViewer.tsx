// 玄庫看譜頁（#/lib/<著手串>）：名人林書玄整理的《玄》棋譜庫（RenLib .lib，約 110 萬節點）
// 一路點到最後的變化；也能開自己的 .lib（只在瀏覽器裡讀，不上傳）。
//
// - 盤上：庫內下一手——有標字的（A1、D!、G…）照評等上色，沒標字的畫小點；點了就走下去。
// - 點庫外的空點也能繼續擺（之後的研究交給 Rapfi 分析、或「在擺譜開啟」存檔）。
// - 右鍵／← 退一手、→ 走第一個變化；網址即局面（#/lib/hhhgii…，每手 2 字元 a–o），可分享、可上一頁。
// 解析在 src/renlib/renlib.ts；玄庫資料加密在 public/xuan/xuan.vault（scripts/build-xuan.mjs 產生、已去棋手資訊），
// 要密碼才解得開（src/renlib/vault.ts）；沒密碼也能開本機 .lib。
import { useEffect, useMemo, useState } from 'react'
import Board, { type LabelMark } from './Board.tsx'
import RapfiPanel from './RapfiPanel.tsx'
import { coordName } from './coords.ts'
import { createBoard, set } from '../engine/board.ts'
import { serializeRecord } from '../engine/record.ts'
import { BLACK, WHITE, type Pos } from '../engine/types.ts'
import { findOpeningByMoves, OPENINGS } from '../content/openings.ts'
import { children, commentText, isMove, movesTo, parseRenlib, posToXY, type RenTree } from '../renlib/renlib.ts'
import { loadPvShow, savePvShow } from '../storage.ts'
import { remainingPv, type PvAnchor } from './pvFollow.ts'
import { lockXuan, xuanIfUnlocked, type XuanBundle } from '../renlib/vault.ts'
import XuanUnlock from './XuanUnlock.tsx'
import { useT } from '../i18n/index.ts'

const A = 97
const encodeMoves = (ms: readonly Pos[]) => ms.map((p) => String.fromCharCode(A + p.x, A + p.y)).join('')
const decodeMoves = (s: string): Pos[] => {
  const out: Pos[] = []
  for (let i = 0; i + 1 < s.length; i += 2) {
    const x = s.charCodeAt(i) - A
    const y = s.charCodeAt(i + 1) - A
    if (x < 0 || x > 14 || y < 0 || y > 14) break
    out.push({ x, y })
  }
  return out
}

// 評等顏色（玄：A 黑必勝 … G 白必勝；其他字一律金色）
const GRADE_COLOR: Record<string, string> = {
  A: '#2b8a3e',
  B: '#1971c2',
  C: '#1971c2',
  D: '#495057',
  E: '#e8590c',
  F: '#e8590c',
  G: '#c92a2a',
}
const GRADE_ORDER = 'ABCDEFG'

// 庫裡文字以 raw 讀入（字元＝原位元組），顯示時才解碼：先試 Big5；若出現 Big5 下的
// 注音符號／﹝（簡體 GBK 的「，」「。」誤讀成 Big5 的典型樣子）改用 GBK。控制字元＝舊版雜訊，不顯示。
const big5 = new TextDecoder('big5')
const gbk = new TextDecoder('gbk')
function decodeText(raw: string): string {
  const bytes = Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
  let s = big5.decode(bytes)
  if (/[ㄅ-ㄩ﹝﹞]/.test(s)) s = gbk.decode(bytes)
  // eslint-disable-next-line no-control-regex -- 舊版註解雜訊就是控制字元
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f�]/.test(s.replace('\x08', ''))) return ''
  return s
}

interface Lib {
  tree: RenTree
  name: string
  /** 開局 id → 庫內第 3 手節點（跳開局用）。 */
  openings: Map<string, number>
}

const XUAN_NAME = '玄（林書玄整理）'

// 換頁再回來不重抓重解析（110 萬節點解析約 0.1～0.3 秒）
let cached: Lib | null = null

function indexOpenings(tree: RenTree): Map<string, number> {
  const m = new Map<string, number>()
  const walk = (n: number, depth: number) => {
    for (const c of children(tree, n)) {
      if (!isMove(tree, c)) continue
      if (depth + 1 < 3) walk(c, depth + 1)
      else {
        const op = findOpeningByMoves(movesTo(tree, c))
        if (op && !m.has(op.id)) m.set(op.id, c)
      }
    }
  }
  walk(0, 0)
  return m
}

function buildLib(buf: Uint8Array, name: string): Lib {
  const tree = parseRenlib(buf, 'raw')
  return { tree, name, openings: indexOpenings(tree) }
}

export default function LibViewer({ path }: { path: string }) {
  const t = useT()
  const [lib, setLib] = useState<Lib | null>(cached)
  const [err, setErr] = useState('')
  const [locked, setLocked] = useState(false)
  const [pvShow, setPvShow] = useState(loadPvShow)
  // Rapfi 建議路線錨點（同擺譜頁）：照著路線點下去會一路顯示，走別的才收掉
  const [pvAnchor, setPvAnchor] = useState<PvAnchor | null>(null)

  const openXuanLib = (b: XuanBundle) => {
    cached = buildLib(b.lib, XUAN_NAME)
    setLib(cached)
    setLocked(false)
  }
  useEffect(() => {
    if (cached) return
    xuanIfUnlocked()
      .then((b) => (b ? openXuanLib(b) : setLocked(true)))
      .catch((e) => setErr(t('玄庫載入失敗：{msg}', { msg: e instanceof Error ? e.message : String(e) })))
  }, [])

  const moves = useMemo(() => decodeMoves(path), [path])
  // 走到庫內最深處；之後的著手是庫外自擺
  const { node, inLib } = useMemo(() => {
    if (!lib) return { node: -1, inLib: 0 }
    let cur = 0
    let k = 0
    for (; k < moves.length; k++) {
      let next = -1
      for (const c of children(lib.tree, cur))
        if (isMove(lib.tree, c) && posToXY(lib.tree.pos[c])!.x === moves[k].x && posToXY(lib.tree.pos[c])!.y === moves[k].y) next = c
      if (next === -1) break
      cur = next
    }
    return { node: cur, inLib: k }
  }, [lib, moves])
  const offLib = inLib < moves.length

  const board = useMemo(() => {
    const b = createBoard()
    moves.forEach((m, i) => set(b, m.x, m.y, i % 2 === 0 ? BLACK : WHITE))
    return b
  }, [moves])
  const occupied = (x: number, y: number) => moves.some((m) => m.x === x && m.y === y)

  // 庫內下一手（含標字）：排序＝評等 A→G、名次小的先、再來沒標字的
  const nexts = useMemo(() => {
    if (!lib || offLib) return []
    return children(lib.tree, node)
      .filter((c) => isMove(lib.tree, c))
      .map((c) => {
        const p = posToXY(lib.tree.pos[c])!
        const raw = lib.tree.text.get(c)
        const text = raw ? decodeText(raw) : ''
        return { c, p, text }
      })
      .filter((n) => !occupied(n.p.x, n.p.y))
      .sort((a, b) => rankKey(a.text) - rankKey(b.text))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lib, node, offLib])

  const go = (ms: readonly Pos[]) => {
    location.hash = `#/lib/${encodeMoves(ms)}`
  }
  const back = () => moves.length > 0 && go(moves.slice(0, -1))
  const forward = () => nexts.length > 0 && go([...moves, nexts[0].p])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, select, textarea')) return
      if (e.key === 'ArrowLeft') back()
      else if (e.key === 'ArrowRight') forward()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const onCell = (x: number, y: number) => {
    if (occupied(x, y)) return
    go([...moves, { x, y }])
  }

  const openFile = async (f: File) => {
    try {
      const l = buildLib(new Uint8Array(await f.arrayBuffer()), f.name)
      cached = l
      setLib(l)
      setErr('')
      go([])
    } catch (e) {
      setErr(t('無法讀取 {name}：{msg}', { name: f.name, msg: e instanceof Error ? e.message : String(e) }))
    }
  }

  const filePicker = (
    <details className="lib-legend" open={!lib}>
      <summary>{t('開啟自己的 .lib 檔')}</summary>
      <p className="muted small">{t('RenLib 格式（.lib）；只在瀏覽器裡解析，不會上傳。')}</p>
      <input
        type="file"
        accept=".lib,.LIB,.txt,.TXT"
        onChange={(e) => e.target.files?.[0] && openFile(e.target.files[0])}
        aria-label={t('開啟 lib 檔')}
      />
    </details>
  )

  if (!lib)
    return (
      <div className="page">
        {locked ? <XuanUnlock onOpen={openXuanLib} /> : !err && <p>{t('載入玄庫中…')}</p>}
        {err && <p className="msg err">{err}</p>}
        {locked && <div className="panel xuan-lock">{filePicker}</div>}
      </div>
    )

  const marks: LabelMark[] = nexts.map(({ p, text }) => ({
    x: p.x,
    y: p.y,
    label: text,
    color: text ? (GRADE_COLOR[text[0]] ?? '#e0a336') : '#7048e8',
  }))
  const comment = !offLib && lib.tree.comment.get(node) ? decodeText(commentText(lib.tree.comment.get(node)!)) : ''
  const legend = lib.tree.comment.get(0) ? decodeText(commentText(lib.tree.comment.get(0)!)) : ''
  const op = moves.length >= 3 ? findOpeningByMoves(moves.slice(0, 3)) : null
  const toMove = moves.length % 2 === 0 ? BLACK : WHITE
  const pvAll = remainingPv(pvAnchor, board)
  const pvLine = pvShow === 0 ? pvAll : pvAll.slice(0, pvShow)
  const graded = nexts.filter((n) => n.text)

  return (
    <div className="page play-page lib-page">
      <div className="board-col">
        <p className="status">
          {op ? `${t(op.name)}・` : ''}
          {t('第 {n} 手', { n: moves.length })}
          {moves.length > 0 ? `（${coordName(moves[moves.length - 1])}）` : ''}
          <span className="muted">　{t('輪{c}', { c: toMove === BLACK ? t('黑') : t('白') })}</span>
          {offLib ? (
            <span className="warn-text">　{t('庫外第 {n} 手（自擺）', { n: moves.length - inLib })}</span>
          ) : (
            <span className="muted">　{t('庫內下一手 {n} 個', { n: nexts.length })}</span>
          )}
        </p>
        <Board
          board={board}
          lastMove={moves[moves.length - 1] ?? null}
          numbered={moves}
          marks={marks}
          pv={pvLine}
          pvStart={moves.length + 1}
          onCell={onCell}
          onRightClick={back}
          ariaLabel={t('玄庫棋盤')}
        />
        <p className="muted small">
          {t('點盤上的標記走下去（')}<b style={{ color: GRADE_COLOR.A }}>{t('A 黑必勝')}</b>／
          <b style={{ color: GRADE_COLOR.C }}>{t('B・C 黑優')}</b>／<b style={{ color: GRADE_COLOR.D }}>{t('D 均勢')}</b>／
          <b style={{ color: GRADE_COLOR.F }}>{t('E・F 白優')}</b>／<b style={{ color: GRADE_COLOR.G }}>{t('G 白必勝')}</b>，
          <span style={{ color: '#7048e8' }}>{t('● 庫內沒標字的變化')}</span>{t('）；右鍵或 ← 退一手、→ 走第一個變化。')}
        </p>
      </div>
      <aside className="panel lib-side">
        <h2>{t('玄庫看譜')}</h2>
        <p className="muted small">
          {lib.name === XUAN_NAME ? (
            <>
              {t('《玄》棋譜庫，名人林書玄整理，共 {n} 個節點（限知道密碼的人使用，請勿外流）。', { n: lib.tree.size.toLocaleString() })}{' '}
              <button
                className="linklike"
                onClick={() => {
                  lockXuan()
                  cached = null
                  setLib(null)
                  setLocked(true)
                }}
              >
                {t('🔒 鎖上')}
              </button>
            </>
          ) : (
            <>
              {t('本機檔案「{name}」，{n} 個節點（只在你的瀏覽器裡讀，不會上傳）。', { name: lib.name, n: lib.tree.size.toLocaleString() })}
            </>
          )}
        </p>
        <div className="btn-row">
          <label>
            {t('跳到開局')}{' '}
            <select
              value={op?.id ?? ''}
              onChange={(e) => {
                const n = lib.openings.get(e.target.value)
                if (n !== undefined) go(movesTo(lib.tree, n))
              }}
              aria-label={t('跳到開局')}
            >
              <option value="">—</option>
              {OPENINGS.filter((o) => lib.openings.has(o.id)).map((o) => (
                <option key={o.id} value={o.id}>
                  {t(o.name)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="btn-row">
          <button className="btn" onClick={() => go([])} disabled={moves.length === 0}>
            {t('⏮ 開頭')}
          </button>
          <button className="btn" onClick={back} disabled={moves.length === 0}>
            {t('◀ 上一手')}
          </button>
          <button className="btn" onClick={forward} disabled={nexts.length === 0}>
            {t('第一變化 ▶')}
          </button>
          {offLib && (
            <button className="btn" onClick={() => go(moves.slice(0, inLib))}>
              {t('回庫內')}
            </button>
          )}
        </div>
        {comment && <p className="lib-comment">💬 {comment}</p>}
        {!offLib && nexts.length > 0 && (
          <div className="lib-nexts" aria-label={t('庫內下一手')}>
            {(graded.length > 0 ? graded : nexts).slice(0, 60).map(({ p, text }) => (
              <button
                key={`${p.x},${p.y}`}
                className="lib-next"
                style={text ? { borderColor: GRADE_COLOR[text[0]] ?? '#e0a336', color: GRADE_COLOR[text[0]] } : undefined}
                onClick={() => go([...moves, p])}
              >
                {text && <b>{text}</b>} {coordName(p)}
              </button>
            ))}
            {graded.length > 0 && nexts.length > graded.length && (
              <span className="muted small">{t('＋{n} 個沒標字的變化（盤上紫點）', { n: nexts.length - graded.length })}</span>
            )}
          </div>
        )}
        {!offLib && nexts.length === 0 && moves.length > 0 && <p className="muted">{t('這條變化在庫裡到此為止——可以繼續自擺，或交給 Rapfi。')}</p>}

        <h2>{t('後續研究')}</h2>
        <RapfiPanel
          buildInput={() => ({ moves })}
          rule="renju"
          positionKey={pvAll.length > 0 && pvAnchor ? pvAnchor.key : path}
          toMoveLabel={toMove === BLACK ? t('黑') : t('白')}
          pvShow={pvShow}
          onPvShow={(n) => {
            setPvShow(n)
            savePvShow(n)
          }}
          onResult={(a, key) => setPvAnchor({ root: Uint8Array.from(board), line: a.pv, color: toMove, key })}
        />
        <p>
          <a className="btn" href={`#/study/${serializeRecord({ rule: 'renju', moves })}`}>
            {t('在擺譜開啟這個局面 →')}
          </a>
        </p>

        {legend && (
          <details className="lib-legend">
            <summary>{t('評等說明（庫內原註）')}</summary>
            <pre>{legend}</pre>
          </details>
        )}
        {filePicker}
        {err && <p className="msg err">{err}</p>}
      </aside>
    </div>
  )
}

/** 標字排序鍵：A1 < A2 < A < B … < G < 數字（幾打）< 其他字 < 沒標字。 */
function rankKey(text: string): number {
  if (!text) return 1e6
  const g = GRADE_ORDER.indexOf(text[0])
  // 白 4 層的「14+」「11D」＝幾打（＋評等）：照數字小到大
  if (g === -1) return /^\d/.test(text) ? 5e5 + parseInt(text, 10) : 9e5
  const n = parseInt(text.slice(1), 10)
  return g * 1000 + (Number.isNaN(n) ? 999 : n)
}
