// 對局狀態機：落子/悔棋/勝負，含連珠禁手判負。
import {
  BLACK,
  WHITE,
  EMPTY,
  idx,
  opponent,
  type Color,
  type GameResult,
  type Pos,
  type Rule,
} from './types.ts'
import { boardIsFull, createBoard, isEmptyAt, set, type Board } from './board.ts'
import { isWinningMove, makesExactFive } from './rules.ts'
import { isForbiddenMove } from './forbidden.ts'
import { serializeRecord, type GameRecord } from './record.ts'

export class Game {
  readonly rule: Rule
  readonly board: Board
  readonly moves: Pos[] = []
  result: GameResult = { kind: 'ongoing' }

  constructor(rule: Rule = 'renju') {
    this.rule = rule
    this.board = createBoard()
  }

  get toMove(): Color {
    return this.moves.length % 2 === 0 ? BLACK : WHITE
  }

  /** 落子。回傳 false = 非法（占用/盤外/對局已結束）。
   *  連珠模式黑棋踩禁手：落子成立但立即判負（result 變 white win / forbidden），
   *  與正式規則「踩禁手判負」一致。五連豁免已在 isForbiddenMove 內處理。 */
  play(x: number, y: number): boolean {
    if (this.result.kind !== 'ongoing') return false
    if (!isEmptyAt(this.board, x, y)) return false
    const color = this.toMove

    let forbidden = false
    if (this.rule === 'renju' && color === BLACK) {
      forbidden = isForbiddenMove(this.board, x, y).forbidden
    }

    set(this.board, x, y, color)
    this.moves.push({ x, y })

    if (forbidden) {
      // isForbiddenMove 已含五連豁免（成五不算禁手），這裡必為判負。
      this.result = { kind: 'win', winner: WHITE, reason: 'forbidden' }
      return true
    }
    if (isWinningMove(this.board, x, y, color, this.rule)) {
      const overline =
        !(this.rule === 'renju' && color === BLACK) &&
        !makesExactFive(this.board, x, y, color)
      this.result = { kind: 'win', winner: color, reason: overline ? 'overline' : 'five' }
      return true
    }
    if (boardIsFull(this.board)) this.result = { kind: 'draw' }
    return true
  }

  /** 悔一手。回傳 false = 沒得悔。悔棋會把結束的對局拉回進行中。 */
  undo(): boolean {
    const last = this.moves.pop()
    if (!last) return false
    this.board[idx(last.x, last.y)] = EMPTY
    this.result = { kind: 'ongoing' }
    return true
  }

  /** 目前手番方在 (x,y) 落子是否合法可下（不含「合法但判負」的禁手點：
   *  禁手點回傳 true——規則允許黑棋下出禁手（然後判負），UI 另行標示警告）。 */
  canPlay(x: number, y: number): boolean {
    return this.result.kind === 'ongoing' && isEmptyAt(this.board, x, y)
  }

  toRecord(): GameRecord {
    return { rule: this.rule, moves: [...this.moves] }
  }

  serialize(): string {
    return serializeRecord(this.toRecord())
  }

  /** 由棋譜重播建局（逐手走 play，含禁手判負邏輯）。非法棋譜回 null。 */
  static fromRecord(rec: GameRecord): Game | null {
    const g = new Game(rec.rule)
    for (const m of rec.moves) {
      if (!g.play(m.x, m.y)) return null
    }
    return g
  }

  static resign(g: Game): void {
    if (g.result.kind !== 'ongoing') return
    g.result = { kind: 'win', winner: opponent(g.toMove), reason: 'resign' }
  }
}
