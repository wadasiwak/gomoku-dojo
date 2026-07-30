// RIF 26 開局珠型資料（直接開局 13＋間接開局 13）。
//
// 名稱／編號／珠型位置查證來源（2026-07 覆核）：
//   - renju.net/openings/ 官方列表與打點編號圖
//     （/upload/staticfiles/direct_openings.png、indirect_openings.png）
//   - en.wikipedia.org/wiki/Renju_opening_pattern（同組圖＋主流優劣評註）
//   - 587.renju.org.tw/open.htm（台灣連珠教學站，中文名稱對照）
// scripts/check-openings.mjs 另備一份獨立轉錄的座標對照表互相印證。
//
// record：前三手棋譜（record v1 格式、連珠規則）。黑1 一律天元 h8；
// 直接開局白2 = h9（天元正上）、間接開局白2 = i9（天元右上斜鄰）。
// intro / tendency 為主流研究傾向的保守白話描述（上線前送用戶審稿）。
import { parseRecord } from '../engine/record.ts'
import { canonicalMovesKey } from '../engine/symmetry.ts'
import type { Pos } from '../engine/types.ts'

export type OpeningKind = 'direct' | 'indirect'

export interface Opening {
  /** 'd1'..'d13'（直接）/ 'i1'..'i13'（間接），編號同 renju.net 官方圖。 */
  id: string
  /** 漢字名。 */
  name: string
  kind: OpeningKind
  /** 官方圖打點編號 1..13。 */
  index: number
  /** 前三手棋譜（record v1、renju）。 */
  record: string
  /** 主流優劣傾向短標籤（保守措辭）。 */
  tendency: '黑大優' | '黑優' | '黑稍優' | '約均衡' | '白稍優' | '白大優'
  /** 黑方有利度 -3..3（AI 規約選開局用；|level| ≤ 1 視為均衡池）。 */
  level: -3 | -1 | 0 | 1 | 2 | 3
  /** 白話介紹（60–120 字）。 */
  intro: string
}

export const OPENING_KIND_LABEL: Record<OpeningKind, string> = {
  direct: '直接開局',
  indirect: '間接開局',
}

export const TENDENCY_LEVEL: Record<Opening['tendency'], number> = {
  黑大優: 3,
  黑優: 2,
  黑稍優: 1,
  約均衡: 0,
  白稍優: -1,
  白大優: -3,
}

export const OPENINGS: Opening[] = [
  // ---- 直接開局（白2 = h9）------------------------------------------------
  {
    id: 'd1',
    name: '寒星',
    kind: 'direct',
    index: 1,
    record: 'r1:hhhghf', // h8, h9, h10
    tendency: '黑大優',
    level: 3,
    intro:
      '三子沿中線疊成一直排，黑第 3 手隔著白子與天元相望，左右完全對稱。黑可向兩翼任意展開攻勢，主流研究認為黑大優、甚至有黑必勝的定論；正式規約下暫白幾乎都會選擇換邊。',
  },
  {
    id: 'd2',
    name: '溪月',
    kind: 'direct',
    index: 2,
    record: 'r1:hhhgif', // h8, h9, i10
    tendency: '黑大優',
    level: 3,
    intro:
      '白2 在天元正上方，黑3 斜貼白子右上。黑棋形靈活、攻路多，定式研究認為黑方攻勢難以抵擋，主流視為黑大優並常列入黑必勝討論；規約實戰中暫白多半直接換邊。',
  },
  {
    id: 'd3',
    name: '疏星',
    kind: 'direct',
    index: 3,
    record: 'r1:hhhgjf', // h8, h9, j10
    tendency: '約均衡',
    level: 0,
    intro:
      '黑3 跳到天元右上斜隔一路處，三子互不接觸、棋形鬆散。攻勢不若花月、浦月鋒利，但局面均衡有彈性，一般認為大致兩分、白方略可滿意，是正式規約下暫黑常選的安全開局之一。',
  },
  {
    id: 'd4',
    name: '花月',
    kind: 'direct',
    index: 4,
    record: 'r1:hhhgig', // h8, h9, i9
    tendency: '黑大優',
    level: 3,
    intro:
      '黑3 緊貼白2 右側、位於天元右上斜鄰，是名氣最大的珠型之一。黑方攻勢兇猛、變化雖繁但結論明確，主流研究普遍認為黑必勝已成定論；規約下暫白幾乎必換邊，實戰多作讓先或研究題材。',
  },
  {
    id: 'd5',
    name: '殘月',
    kind: 'direct',
    index: 5,
    record: 'r1:hhhgjg', // h8, h9, j9
    tendency: '黑優',
    level: 2,
    intro:
      '黑3 落在天元右上方的日字位（桂馬跳）。黑棋形帶斜線潛力、攻守兼備，一般認為黑方優勢明顯但不若花月極端，仍留有實戰空間；規約下暫白通常傾向換邊，黑方需備妥讓先腹案。',
  },
  {
    id: 'd6',
    name: '雨月',
    kind: 'direct',
    index: 6,
    record: 'r1:hhhgih', // h8, h9, i8
    tendency: '黑大優',
    level: 3,
    intro:
      '黑3 在天元右鄰、與白2 斜對，兩枚黑子橫向相連成中心厚勢。黑的攻擊點豐富、節奏也快，主流研究認為黑大優並常列入黑必勝討論；規約實戰中白方多半選擇換邊。',
  },
  {
    id: 'd7',
    name: '金星',
    kind: 'direct',
    index: 7,
    record: 'r1:hhhgjh', // h8, h9, j8
    tendency: '黑大優',
    level: 3,
    intro:
      '黑3 在天元右方隔一路，兩枚黑子橫向跳開、涵蓋面寬，可雙翼展開。主流研究認為黑大優、亦有黑必勝結論之說，是直接開局中黑方火力很強的珠型；規約下暫白通常直接換邊。',
  },
  {
    id: 'd8',
    name: '松月',
    kind: 'direct',
    index: 8,
    record: 'r1:hhhghi', // h8, h9, h7
    tendency: '黑稍優',
    level: 1,
    intro:
      '黑3 在天元正下方，兩枚黑子縱向相連、白子壓在頂端，左右對稱。棋形穩健厚實，攻擊不如星月類珠型激烈，一般認為黑稍優；規約下換邊與否常取決於棋手風格，實戰出現率不低。',
  },
  {
    id: 'd9',
    name: '丘月',
    kind: 'direct',
    index: 9,
    record: 'r1:hhhgii', // h8, h9, i7
    tendency: '黑稍優',
    level: 1,
    intro:
      '黑3 斜貼天元右下方，與上方的白2 一縱一斜錯開。黑形厚實但攻勢平緩，變化相對平穩，一般認為黑稍優，是規約下暫黑可以考慮的低風險選擇之一，也常見於讓先研究。',
  },
  {
    id: 'd10',
    name: '新月',
    kind: 'direct',
    index: 10,
    record: 'r1:hhhgji', // h8, h9, j7
    tendency: '黑優',
    level: 2,
    intro:
      '黑3 落在天元右下方的日字位，斜線與橫線都留有發展空間，後續定式研究相當深。攻守資源平均、實戰內容豐富，一般認為黑方有優勢；規約對局中屬於熱門珠型，暫白換邊與否見仁見智。',
  },
  {
    id: 'd11',
    name: '瑞星',
    kind: 'direct',
    index: 11,
    record: 'r1:hhhghj', // h8, h9, h6
    tendency: '約均衡',
    level: 0,
    intro:
      '黑3 在天元正下方隔一路，三子成中線上的鬆散縱列，左右對稱。棋形平穩、即戰攻擊點少，一般認為接近兩分或黑略好，是暫黑用來避免被換邊吃虧的均衡選擇，實戰多走向細棋。',
  },
  {
    id: 'd12',
    name: '山月',
    kind: 'direct',
    index: 12,
    record: 'r1:hhhgij', // h8, h9, i6
    tendency: '黑優',
    level: 2,
    intro:
      '黑3 落在天元右下方的縱向日字位，兼具斜線與縱線的雙重發展空間，攻勢不俗、定式研究也深。一般認為黑方優勢；規約下暫白多會認真考慮換邊，黑方應準備讓先方案。',
  },
  {
    id: 'd13',
    name: '遊星',
    kind: 'direct',
    index: 13,
    record: 'r1:hhhgjj', // h8, h9, j6
    tendency: '白大優',
    level: -3,
    intro:
      '黑3 跳到天元右下斜隔一路，與白2 分處天元兩側，黑子彼此失聯、難以協同作戰。主流研究認為白大優、甚至有白必勝之說，是黑方最差的珠型之一；規約下暫黑幾乎不會主動擺出此型。',
  },
  // ---- 間接開局（白2 = i9）------------------------------------------------
  {
    id: 'i1',
    name: '長星',
    kind: 'indirect',
    index: 1,
    record: 'r1:hhigjf', // h8, i9, j10
    tendency: '約均衡',
    level: 0,
    intro:
      '三子沿同一條斜線排開，黑1、黑3 隔著白2 相望，與寒星互為縱斜對應。斜線的張力比中線弱，黑攻勢不易成形，一般認為大致兩分、白方略舒服，是規約下暫黑的均衡選項之一。',
  },
  {
    id: 'i2',
    name: '峽月',
    kind: 'indirect',
    index: 2,
    record: 'r1:hhigjg', // h8, i9, j9
    tendency: '黑大優',
    level: 3,
    intro:
      '白2 斜鄰天元，黑3 橫貼在白2 右側。黑的攻擊點集中於右翼、可借白子借力成形，主流研究認為黑大優並常列入黑必勝討論；正式規約下暫白多半直接換邊，實戰少見黑方真正執行此型。',
  },
  {
    id: 'i3',
    name: '恆星',
    kind: 'indirect',
    index: 3,
    record: 'r1:hhigjh', // h8, i9, j8
    tendency: '黑大優',
    level: 3,
    intro:
      '黑3 在天元右方隔一路、斜貼白2 右下。黑橫向跳二配合中心厚勢，攻守路線清晰、定式結論明確，主流視為黑大優的代表珠型之一；規約下白方幾乎必然換邊。',
  },
  {
    id: 'i4',
    name: '水月',
    kind: 'indirect',
    index: 4,
    record: 'r1:hhigji', // h8, i9, j7
    tendency: '黑大優',
    level: 3,
    intro:
      '黑3 落在天元右下方的日字位，斜線與橫線攻勢可以互相支援，是間接開局中的著名強型。主流研究普遍認為黑大優，黑必勝的定論流傳已久；規約下多作讓先與研究題材使用。',
  },
  {
    id: 'i5',
    name: '流星',
    kind: 'indirect',
    index: 5,
    record: 'r1:hhigjj', // h8, i9, j6
    tendency: '白稍優',
    level: -1,
    intro:
      '黑3 跳到天元右下斜隔一路，與白2 拉成對角，是黑子彼此距離最遠的珠型之一。黑難以形成合力、白反而好整以暇，一般認為白略優；規約下偶見暫黑用它引誘對手不換邊。',
  },
  {
    id: 'i6',
    name: '雲月',
    kind: 'indirect',
    index: 6,
    record: 'r1:hhigih', // h8, i9, i8
    tendency: '黑大優',
    level: 3,
    intro:
      '黑3 在天元右鄰、恰在白2 正下方，兩枚黑子橫向相連且壓住白子出路。黑的攻擊資源豐富、成形速度快，主流認為黑大優、亦有黑必勝結論之說；規約實戰中白方多選擇換邊。',
  },
  {
    id: 'i7',
    name: '浦月',
    kind: 'indirect',
    index: 7,
    record: 'r1:hhigii', // h8, i9, i7
    tendency: '黑大優',
    level: 3,
    intro:
      '黑3 在天元右下斜鄰，與白2 隔一點縱向相對。黑方斜線火力全開，與花月並稱兩大最強珠型，黑必勝已是主流定論；規約下白方必然換邊，此型多用於讓先對局與詰棋研究。',
  },
  {
    id: 'i8',
    name: '嵐月',
    kind: 'indirect',
    index: 8,
    record: 'r1:hhigij', // h8, i9, i6
    tendency: '黑大優',
    level: 3,
    intro:
      '黑3 落在天元右下的縱向日字位、白2 正下方隔兩路。黑的縱線與斜線互為犄角、攻勢連貫，主流研究認為黑大優、亦有黑必勝之說；規約下暫白通常選擇換邊。',
  },
  {
    id: 'i9',
    name: '銀月',
    kind: 'indirect',
    index: 9,
    record: 'r1:hhighi', // h8, i9, h7
    tendency: '黑優',
    level: 2,
    intro:
      '黑3 在天元正下方，與白2 斜對、三子構成一道折線。棋形均衡中帶攻勢，定式研究極深、雙方都有可下之處，一般認為黑優但仍有實戰空間，是規約對局中出現率很高的珠型。',
  },
  {
    id: 'i10',
    name: '明星',
    kind: 'indirect',
    index: 10,
    record: 'r1:hhighj', // h8, i9, h6
    tendency: '黑大優',
    level: 3,
    intro:
      '黑3 在天元正下方隔一路，與白2 遙遙斜對。黑的中線縱向潛力配合斜線轉換相當難防，主流研究認為黑大優、常列入黑必勝討論；規約下白方多半換邊，黑方需熟讓先變化。',
  },
  {
    id: 'i11',
    name: '斜月',
    kind: 'indirect',
    index: 11,
    record: 'r1:hhiggi', // h8, i9, g7
    tendency: '黑稍優',
    level: 1,
    intro:
      '黑3 斜貼天元左下，與黑1、白2 連成同一條斜線、兩枚黑子相連。棋形緊湊，但斜線的一頭已被白子壓住，攻勢受限，一般認為黑略好、內容大致均衡，是規約下的中性選擇之一。',
  },
  {
    id: 'i12',
    name: '名月',
    kind: 'indirect',
    index: 12,
    record: 'r1:hhiggj', // h8, i9, g6
    tendency: '黑優',
    level: 2,
    intro:
      '黑3 落在天元左下方的日字位、位於白2 的斜對側。黑形舒展，斜線與縱線皆留有後續手段，一般認為黑方優勢、變化也富實戰性；規約下暫白常會換邊，黑方需備讓先腹案。',
  },
  {
    id: 'i13',
    name: '彗星',
    kind: 'indirect',
    index: 13,
    record: 'r1:hhigfj', // h8, i9, f6
    tendency: '白大優',
    level: -3,
    intro:
      '黑3 沿白2－天元的斜線反向跳隔一路，三子同線但黑子彼此脫節。黑既難搶先手攻點、又背著禁手包袱，主流研究認為白大優、白必勝之說流傳最廣；暫黑實戰幾乎不會採用。',
  },
]

const BY_ID = new Map(OPENINGS.map((o) => [o.id, o]))
export const getOpening = (id: string): Opening | undefined => BY_ID.get(id)

/** 前三手著手序列（record 解析快取）。 */
const MOVES_CACHE = new Map<string, Pos[]>()
export function openingMoves(o: Opening): Pos[] {
  let m = MOVES_CACHE.get(o.id)
  if (!m) {
    m = parseRecord(o.record)!.moves
    MOVES_CACHE.set(o.id, m)
  }
  return m
}

// 對稱歸一 → 珠型 反查表：任何合法前三手經 8 對稱歸一後必落在 26 型之一。
const CANON = new Map(OPENINGS.map((o) => [canonicalMovesKey(openingMoves(o)), o]))

/** 由前三手（任意方位）比對 26 珠型；非 3 手或不成型回 null。 */
export function findOpeningByMoves(moves: readonly Pos[]): Opening | null {
  if (moves.length !== 3) return null
  return CANON.get(canonicalMovesKey(moves)) ?? null
}

/** AI 規約擺開局的均衡池（暫黑不該擺必勝型送對手換邊）。 */
export const BALANCED_POOL: Opening[] = OPENINGS.filter((o) => Math.abs(o.level) <= 1)
