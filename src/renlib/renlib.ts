// RenLib .lib 棋譜庫讀寫（照 gomoku/RenLib 原始碼 RenLibDoc::AddLibrary 移植）。
//
// 檔案格式：20 位元組檔頭（\xFFRenLib\xFF + 版本 3.x + 補 0xFF），之後是先序（preorder）
// 走訪的節點流，每個節點 2 位元組 [pos, flags]：
//   pos   ＝ 0 為根／無著手；否則 x = pos % 16（1 起算）、y = pos / 16 + 1（1 起算、y=1 頂列）
//   flags ＝ 0x80 DOWN（這個節點之後還有兄弟——讀完它的子樹要回到它的父節點）
//            0x40 RIGHT（這條線到此為止＝葉節點，回到最近一個 DOWN 的父節點）
//            0x20 OLD_COMMENT／0x08 COMMENT（後接註解字串）
//            0x01 EXTENSION（後接 2 位元組延伸旗標；第二個位元組 bit0＝BOARD_TEXT，後接盤面文字）
//   字串一律成對讀（2 位元組一組），遇 0 結束；新式註解用 \x08 分隔單行與多行。
// 例：[78 08 …註解…][68 98 …] ＝ 天元（帶註解）→ 白 2 在天元正上（DOWN＋註解）…
//
// 讀出來的樹存成扁平陣列（110 萬節點用物件太慢太胖）：節點 i 的子節點是
// firstChild[i]、nextSibling[firstChild[i]]、…；根節點＝0。
import type { Pos } from '../engine/types.ts'

const DOWN = 0x80
const RIGHT = 0x40
const OLD_COMMENT = 0x20
const COMMENT = 0x08
const NO_MOVE = 0x02
const EXTENSION = 0x01
const HEADER = 20

export interface RenTree {
  size: number
  /** RenLib pos 位元組（0＝根／無著手）。 */
  pos: Uint8Array
  /** 原始 flags（NO_MOVE 等），只保留低位元組。 */
  flags: Uint8Array
  parent: Int32Array
  firstChild: Int32Array
  nextSibling: Int32Array
  /** 盤面文字（打點標籤，如 A1、D!、G）。 */
  text: Map<number, string>
  /** 註解（單行與多行以換行接起來）。 */
  comment: Map<number, string>
}

/** RenLib pos → 站內座標（0 起算、y=0 頂列）；0 → null。 */
export const posToXY = (p: number): Pos | null => (p === 0 ? null : { x: (p % 16) - 1, y: Math.floor(p / 16) })
export const xyToPos = (q: Pos): number => q.y * 16 + q.x + 1

/** 這個節點是否為真正的著手（有位置、非 NO_MOVE）。 */
export const isMove = (t: RenTree, i: number): boolean => t.pos[i] !== 0 && !(t.flags[i] & NO_MOVE)

export function isRenlib(buf: Uint8Array): boolean {
  return buf.length >= HEADER && buf[0] === 0xff && String.fromCharCode(...buf.subarray(1, 7)) === 'RenLib'
}

/** 解析 .lib；文字預設以 Big5 解碼（台灣常見），也可傳 'gbk' 等；
 *  'raw'＝每個位元組原樣轉一個字元（build 腳本改寫檔案用，writeRenlib 可無損寫回）。 */
export function parseRenlib(buf: Uint8Array, encoding = 'big5'): RenTree {
  if (!isRenlib(buf)) throw new Error('不是 RenLib 檔案')
  const dec = encoding === 'raw' ? null : new TextDecoder(encoding)
  // 節點數上限＝(檔長 − 檔頭) / 2
  const cap = Math.max(1, (buf.length - HEADER) >> 1) + 1
  const pos = new Uint8Array(cap)
  const flags = new Uint8Array(cap)
  const parent = new Int32Array(cap).fill(-1)
  const firstChild = new Int32Array(cap).fill(-1)
  const lastChild = new Int32Array(cap).fill(-1)
  const nextSibling = new Int32Array(cap).fill(-1)
  const text = new Map<number, string>()
  const comment = new Map<number, string>()
  let size = 1 // 0＝根

  let i = HEADER
  const readStr = (old: boolean): string => {
    const out: number[] = []
    for (;;) {
      if (i + 1 >= buf.length + 1) break
      const a = buf[i]
      const b = buf[i + 1] ?? 0
      i += 2
      if (old) {
        out.push(a & 0x7f)
        if (a & 0x80) break
        out.push(b & 0x7f)
        if (b & 0x80) break
      } else {
        if (a === 0) break
        out.push(a)
        if (b === 0) break
        out.push(b)
      }
    }
    return dec ? dec.decode(new Uint8Array(out)) : String.fromCharCode(...out)
  }
  const childAt = (p: number, ps: number): number => {
    for (let c = firstChild[p]; c !== -1; c = nextSibling[c]) if (pos[c] === ps) return c
    return -1
  }

  const path: number[] = [0] // 從根到目前節點
  const stack: number[] = [] // DOWN 節點在 path 裡的深度
  let checkRoot = true
  while (i + 1 < buf.length) {
    const ps = buf[i]
    const fl = buf[i + 1]
    i += 2
    let ext = 0
    if (fl & EXTENSION) {
      ext = buf[i + 1]
      i += 2
    }
    let node: number
    if (checkRoot && ps === 0) {
      checkRoot = false
      node = 0
    } else {
      const cur = path[path.length - 1]
      // 同一父節點下同一位置合併（RenLib GetVariant）
      node = childAt(cur, ps)
      if (node === -1) {
        node = size++
        pos[node] = ps
        parent[node] = cur
        if (lastChild[cur] === -1) firstChild[cur] = node
        else nextSibling[lastChild[cur]] = node
        lastChild[cur] = node
      }
      path.push(node)
    }
    flags[node] |= fl & ~(DOWN | RIGHT)
    if (fl & OLD_COMMENT) setComment(comment, node, readStr(true))
    else if (fl & COMMENT) setComment(comment, node, readStr(false))
    if (ext & 0x01) {
      const s = readStr(false)
      if (s) text.set(node, s)
    }
    if (fl & DOWN) stack.push(path.length - 1)
    if (fl & RIGHT && stack.length > 0) path.length = stack.pop()!
  }
  return {
    size,
    pos: pos.slice(0, size),
    flags: flags.slice(0, size),
    parent: parent.slice(0, size),
    firstChild: firstChild.slice(0, size),
    nextSibling: nextSibling.slice(0, size),
    text,
    comment,
  }
}

// 單行與多行之間的 \x08 保留在字串裡（writeRenlib 原樣寫回）；顯示時用 commentText
function setComment(m: Map<number, string>, node: number, raw: string) {
  if (raw.trim()) m.set(node, raw)
}

/** 註解顯示用：\x08 與 \r\n 換成換行。 */
export const commentText = (raw: string): string => raw.replace('\x08', '\n').replace(/\r\n/g, '\n').trim()

export function children(t: RenTree, i: number): number[] {
  const out: number[] = []
  for (let c = t.firstChild[i]; c !== -1; c = t.nextSibling[c]) out.push(c)
  return out
}

/** 從根依序走著手；走不到回 -1。中間遇到「無著手」節點會穿過去（RenLib 偶有）。 */
export function findPath(t: RenTree, moves: readonly Pos[]): number {
  let cur = 0
  for (const m of moves) {
    const want = xyToPos(m)
    let next = -1
    for (const c of children(t, cur)) if (t.pos[c] === want && isMove(t, c)) next = c
    if (next === -1) return -1
    cur = next
  }
  return cur
}

/** 根到節點 i 的著手序列。 */
export function movesTo(t: RenTree, i: number): Pos[] {
  const out: Pos[] = []
  for (let n = i; n > 0; n = t.parent[n]) if (isMove(t, n)) out.push(posToXY(t.pos[n])!)
  return out.reverse()
}

/** 序列化回 RenLib 3.0 格式；t 須以 parseRenlib(buf, 'raw') 讀入（字元＝原位元組）。
 *  keepComment 回 false 的註解不寫出（去掉實戰對局的棋手資訊用）。 */
export function writeRenlib(t: RenTree, keepComment: (s: string) => boolean = () => true): Uint8Array {
  const enc = (s: string): number[] => {
    const out = [...s].map((ch) => ch.charCodeAt(0) & 0xff)
    out.push(0)
    if (out.length % 2) out.push(0)
    return out
  }
  const out: number[] = [0xff, ...'RenLib'.split('').map((c) => c.charCodeAt(0)), 0xff, 3, 0]
  while (out.length < HEADER) out.push(0xff)
  // 先序走訪；DOWN＝還有下一個兄弟，RIGHT＝葉
  const emit = (n: number, isRoot: boolean, hasNext: boolean, isLeaf: boolean) => {
    const c = t.comment.get(n)
    const tx = t.text.get(n)
    const withC = c !== undefined && keepComment(c)
    let fl = t.flags[n] & ~(DOWN | RIGHT | OLD_COMMENT | COMMENT | EXTENSION)
    if (!isRoot && hasNext) fl |= DOWN
    if (isLeaf) fl |= RIGHT
    if (withC) fl |= COMMENT
    if (tx) fl |= EXTENSION
    out.push(t.pos[n], fl)
    if (tx) out.push(0, 1)
    if (withC) out.push(...enc(c!))
    if (tx) out.push(...enc(tx))
  }
  // 迭代版先序（深度可達百餘層，但節點百萬——避免遞迴爆堆疊）
  const st: [number, boolean][] = [[0, false]]
  while (st.length) {
    const [n, hasNext] = st.pop()!
    const kids = children(t, n)
    emit(n, n === 0, hasNext, kids.length === 0 && n !== 0)
    for (let k = kids.length - 1; k >= 0; k--) st.push([kids[k], k < kids.length - 1])
  }
  return new Uint8Array(out)
}
