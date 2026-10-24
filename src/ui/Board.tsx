// 共用 SVG 棋盤：對弈/題庫/重播/科普全站同一顆。
// 石子落在「線交點」（不是格子中央）；座標標記照連珠慣例 A–O × 15..1（A1 左下）。
import { useT } from '../i18n/index.ts'
import { SIZE, BLACK, WHITE, idx, type Color, type Pos } from '../engine/types.ts'
import type { Board as BoardData } from '../engine/board.ts'

const CELL = 36
const PAD = 30
const S = PAD * 2 + CELL * (SIZE - 1) // 564
const cx = (x: number) => PAD + x * CELL
const STARS: Pos[] = [
  { x: 7, y: 7 },
  { x: 3, y: 3 },
  { x: 11, y: 3 },
  { x: 3, y: 11 },
  { x: 11, y: 11 },
]

export interface BoardMark {
  x: number
  y: number
  /** 禁手類別（styling / tooltip 用）。 */
  kind?: string
}

export interface LabelMark {
  x: number
  y: number
  /** 圈內字母（規約兩打 A/B、圖鑑標點用）；空字串＝只畫小圓點（看譜頁：庫內有、沒標字的下一手）。 */
  label: string
  /** 圈與字的顏色（預設金色；看譜頁依評等上色）。 */
  color?: string
}

interface Props {
  board: BoardData
  lastMove?: Pos | null
  /** 黑禁手點 ✕ 標記。 */
  forbidden?: BoardMark[]
  /** 手順編號（重播/解答用）：依序為第 1、2、… 手的座標。 */
  numbered?: Pos[]
  /** AI 建議點標記（研棋/擺譜用）：虛線圈提示、不擋點擊。 */
  hint?: Pos | null
  /** 字母標記點（規約兩打 A/B、圖鑑標點用）：實線圈＋字母、不擋點擊。 */
  marks?: LabelMark[]
  /** Rapfi 建議路線：半透明編號子，不擋點擊。 */
  pv?: { pos: Pos; color: Color }[]
  /** 建議路線第一手的編號（接續盤上手數，避免與真實棋子撞號；預設 1）。 */
  pvStart?: number
  onCell?: (x: number, y: number) => void
  /** 右鍵（退一手）：給了就攔掉瀏覽器右鍵選單。 */
  onRightClick?: () => void
  disabled?: boolean
  /** 只顯示局部（科普例圖用），格座標閉區間。 */
  crop?: { x0: number; y0: number; x1: number; y1: number }
  showCoords?: boolean
  ariaLabel?: string
}

export default function Board({
  board,
  lastMove,
  forbidden = [],
  numbered,
  hint,
  marks = [],
  pv = [],
  pvStart = 1,
  onCell,
  onRightClick,
  disabled,
  crop,
  showCoords = true,
  ariaLabel,
}: Props) {
  const t = useT()
  const label = ariaLabel ?? t('棋盤')
  const view = crop
    ? {
        x: cx(crop.x0) - CELL * 0.55,
        y: cx(crop.y0) - CELL * 0.55,
        w: (crop.x1 - crop.x0) * CELL + CELL * 1.1,
        h: (crop.y1 - crop.y0) * CELL + CELL * 1.1,
      }
    : { x: 0, y: 0, w: S, h: S }

  const numberAt = new Map<number, number>()
  if (numbered) numbered.forEach((p, i) => numberAt.set(idx(p.x, p.y), i + 1))

  const cells: Pos[] = []
  const xr = crop ? [crop.x0, crop.x1] : [0, SIZE - 1]
  const yr = crop ? [crop.y0, crop.y1] : [0, SIZE - 1]
  for (let y = yr[0]; y <= yr[1]; y++)
    for (let x = xr[0]; x <= xr[1]; x++) cells.push({ x, y })

  return (
    <svg
      className="goban"
      viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
      role="grid"
      aria-label={label}
      onContextMenu={
        onRightClick
          ? (e) => {
              e.preventDefault()
              onRightClick()
            }
          : undefined
      }
    >
      <defs>
        <radialGradient id="stone-b" cx="35%" cy="30%" r="80%">
          <stop offset="0%" stopColor="#5a5a66" />
          <stop offset="70%" stopColor="#101014" />
          <stop offset="100%" stopColor="#000" />
        </radialGradient>
        <radialGradient id="stone-w" cx="35%" cy="30%" r="80%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="75%" stopColor="#d9d3c7" />
          <stop offset="100%" stopColor="#b9b2a4" />
        </radialGradient>
      </defs>
      <rect x={view.x} y={view.y} width={view.w} height={view.h} fill="var(--board)" rx="6" />
      {Array.from({ length: SIZE }, (_, i) => (
        <g key={i} stroke="var(--line)" strokeWidth="1.4">
          <line x1={cx(0)} y1={cx(i)} x2={cx(SIZE - 1)} y2={cx(i)} />
          <line x1={cx(i)} y1={cx(0)} x2={cx(i)} y2={cx(SIZE - 1)} />
        </g>
      ))}
      {STARS.map((p) => (
        <circle key={`s${p.x}-${p.y}`} cx={cx(p.x)} cy={cx(p.y)} r="4" fill="var(--line)" />
      ))}
      {showCoords &&
        !crop &&
        Array.from({ length: SIZE }, (_, i) => (
          <g key={`c${i}`} className="coord">
            <text x={cx(i)} y={S - 6}>
              {String.fromCharCode(65 + i)}
            </text>
            <text x={9} y={cx(i) + 4}>
              {SIZE - i}
            </text>
          </g>
        ))}
      {cells.map(({ x, y }) => {
        const v = board[idx(x, y)]
        if (v !== BLACK && v !== WHITE) return null
        const n = numberAt.get(idx(x, y))
        const isLast = lastMove && lastMove.x === x && lastMove.y === y
        return (
          <g key={`p${x}-${y}`}>
            <circle
              className={`stone ${v === BLACK ? 'black' : 'white'}`}
              cx={cx(x)}
              cy={cx(y)}
              r={CELL * 0.46}
              fill={v === BLACK ? 'url(#stone-b)' : 'url(#stone-w)'}
              stroke={v === BLACK ? '#000' : '#a49c8c'}
              strokeWidth="1"
            />
            {n !== undefined && (
              <text
                className="stone-n"
                x={cx(x)}
                y={cx(y) + 5}
                fill={v === BLACK ? '#e8e4f0' : '#222'}
              >
                {n}
              </text>
            )}
            {isLast && n === undefined && (
              <circle className="last-dot" cx={cx(x)} cy={cx(y)} r="5" fill="#ff5d5d" />
            )}
            {isLast && n !== undefined && (
              <circle
                cx={cx(x)}
                cy={cx(y)}
                r={CELL * 0.46}
                fill="none"
                stroke="#ff5d5d"
                strokeWidth="2.5"
              />
            )}
          </g>
        )
      })}
      {hint && (
        <g className="hint-mark" data-hint={`${hint.x},${hint.y}`} pointerEvents="none">
          <title>{t('AI 建議')}</title>
          <circle
            cx={cx(hint.x)}
            cy={cx(hint.y)}
            r={CELL * 0.4}
            fill="none"
            stroke="#2b8ae2"
            strokeWidth="3"
            strokeDasharray="6 5"
          />
          <circle cx={cx(hint.x)} cy={cx(hint.y)} r="4.5" fill="#2b8ae2" />
        </g>
      )}
      {pv.map(({ pos, color }, i) =>
        board[idx(pos.x, pos.y)] === BLACK || board[idx(pos.x, pos.y)] === WHITE ? null : (
          <g
            key={`v${pos.x}-${pos.y}`}
            className="pv-stone"
            data-pv={i + 1}
            data-n={pvStart + i}
            data-pos={`${pos.x},${pos.y}`}
            pointerEvents="none"
          >
            <circle
              cx={cx(pos.x)}
              cy={cx(pos.y)}
              r={CELL * 0.42}
              fill={color === BLACK ? 'url(#stone-b)' : 'url(#stone-w)'}
              opacity={i === 0 ? 0.72 : 0.5}
              stroke={i === 0 ? '#2b8ae2' : 'none'}
              strokeWidth="3"
            />
            <text
              className="stone-n"
              x={cx(pos.x)}
              y={cx(pos.y) + 5}
              fill={color === BLACK ? '#ffffff' : '#111'}
            >
              {pvStart + i}
            </text>
          </g>
        ),
      )}
      {marks.map((m) => {
        const col = m.color ?? '#e0a336'
        return (
          <g
            key={`k${m.x}-${m.y}`}
            className="pt-mark"
            data-mark={m.label}
            data-pos={`${m.x},${m.y}`}
            pointerEvents="none"
          >
            {m.label === '' ? (
              <circle cx={cx(m.x)} cy={cx(m.y)} r={CELL * 0.14} fill={col} />
            ) : (
              <>
                <circle
                  cx={cx(m.x)}
                  cy={cx(m.y)}
                  r={CELL * 0.42}
                  fill={m.color ? 'rgba(255, 255, 255, 0.55)' : 'rgba(224, 163, 54, 0.16)'}
                  stroke={col}
                  strokeWidth="2.5"
                />
                <text
                  x={cx(m.x)}
                  y={cx(m.y) + (m.label.length >= 3 ? 4 : 6)}
                  textAnchor="middle"
                  fill={col}
                  fontSize={m.label.length >= 3 ? 11 : m.label.length === 2 ? 14 : 17}
                  fontWeight="700"
                >
                  {m.label}
                </text>
              </>
            )}
          </g>
        )
      })}
      {forbidden.map((m) => (
        <g
          key={`f${m.x}-${m.y}`}
          className="fb-mark"
          data-fb={`${m.x},${m.y}`}
          stroke="#e03131"
          strokeWidth="3"
          strokeLinecap="round"
        >
          <title>{m.kind ? t('禁手：{kind}', { kind: m.kind }) : t('禁手')}</title>
          <line x1={cx(m.x) - 8} y1={cx(m.y) - 8} x2={cx(m.x) + 8} y2={cx(m.y) + 8} />
          <line x1={cx(m.x) - 8} y1={cx(m.y) + 8} x2={cx(m.x) + 8} y2={cx(m.y) - 8} />
        </g>
      ))}
      {onCell &&
        cells.map(({ x, y }) => (
          <rect
            key={`t${x}-${y}`}
            className="tap"
            x={cx(x) - CELL / 2}
            y={cx(y) - CELL / 2}
            width={CELL}
            height={CELL}
            fill="transparent"
            role="gridcell"
            aria-label={`(${x},${y})`}
            style={{ cursor: disabled ? 'default' : 'pointer' }}
            onClick={() => {
              if (!disabled) onCell(x, y)
            }}
          />
        ))}
    </svg>
  )
}
