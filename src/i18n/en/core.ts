// App shell + 首頁。
import type { Dict } from '../index.ts'

const d: Dict = {
  五子棋道場: 'Gomoku Dojo',
  主導覽: 'Main navigation',
  首頁: 'Home',
  對弈: 'Play',
  特訓: 'Training',
  打點: 'Drill',
  玄庫: 'Xuan Lib',
  題庫: 'Puzzles',
  開局: 'Openings',
  棋譜: 'Records',
  擺譜: 'Study',
  規則: 'Rules',
  資源: 'Links',
  '引擎與題庫為本站原創；連珠規則本身為公有領域。':
    'Engine and puzzles are original to this site; the Renju rules themselves are public domain.',
  '分析引擎 Rapfi © dhbloo，GPL-3.0，原始碼 ': 'Analysis engine Rapfi © dhbloo, GPL-3.0, source: ',
  '（未修改，獨立 WASM Worker 掛載）': ' (unmodified, loaded as a separate WASM worker)',
  // 首頁
  '連珠（禁手）與無禁手雙軌：AI 對弈、VCF 題庫闖關、棋譜重播。所有計算都在你的瀏覽器完成。':
    'Renju (with forbidden moves) and free-style Gomoku: play the AI, solve VCF puzzles, replay games. Everything runs in your browser.',
  '四級 AI、自由對弈或 RIF 正式規約（換邊＋兩打）；即時標記黑禁手點。':
    'Four AI levels, free play or the official RIF opening rule (swap + two fifth-move offers); forbidden points for Black marked live.',
  '戰績 {w} 勝 {l} 敗 {d} 和': 'Record: {w} W / {l} L / {d} D',
  '還沒下過——來一局': 'No games yet. Play one!',
  名人賽特訓: 'Meijin Training',
  '塔拉山口-10 開局對 Rapfi（交換／十打／最後選黑白），可開 30 分＋30 秒棋鐘。':
    'Taraguchi-10 opening vs Rapfi (swap / ten offers / final color choice), optional 30 min + 30 s clock.',
  '對手：Gomocup 冠軍級引擎': 'Opponent: Gomocup champion-class engine',
  打點複習: '5th-Move Drill',
  '《漱星閣開局指南》249 個＋《玄》979 個白 4 變化：在盤上標出黑優與平衡打點，對答案、錯題本複習。':
    '249 White-4 variations from the Shuxingge Opening Guide plus 979 from Xuan: mark the winning and balanced 5th-move points on the board, check answers, review mistakes.',
  '漱星閣群組／名人林書玄整理': 'By the Shuxingge group / Meijin Lin Shu-hsuan',
  玄庫看譜: 'Xuan Library',
  '名人林書玄整理的《玄》棋譜庫：26 開局一路點到最後的變化，評等 A～G 上色，庫外可接 Rapfi 研究。':
    'Meijin Lin Shu-hsuan’s Xuan library: follow every variation of the 26 openings to the end, graded A to G, with Rapfi analysis beyond the book.',
  '🔒 需密碼・名人林書玄整理': '🔒 Password required · by Meijin Lin Shu-hsuan',
  題庫闖關: 'VCF Puzzles',
  'VCF 連續衝四 {n} 題，引擎逐手驗證，另一條殺法也算對。':
    '{n} VCF (continuous-four) puzzles, each move verified by the engine; alternative wins also count.',
  '進度 {a}/{b}': 'Progress {a}/{b}',
  '錯題本 {n}': 'Mistakes {n}',
  棋譜重播: 'Game Records',
  '對局自動存檔，前進後退逐手看；停在任一手可岔出變化自由研棋。':
    'Games are saved automatically; step through move by move, or branch off at any move to explore.',
  '已存 {n} 局': '{n} games saved',
  擺譜研究: 'Study Board',
  '自由擺子建局再試下，隨時按「AI 建議」看引擎這手會下哪。':
    'Set up any position and try moves; press "AI hint" at any time to see what the engine would play.',
  研究工具: 'Research tool',
  開局圖鑑: 'Opening Guide',
  'RIF 26 珠型全收錄：直接／間接開局、主流優劣傾向與白話講解。':
    'All 26 RIF openings: direct and indirect, mainstream evaluations and plain-language notes.',
  '26 珠型・猜名練習': '26 openings · name quiz',
  '連珠禁手是什麼？三型速覽 →': 'What are forbidden moves in Renju? Quick overview →',
  '連珠資源站介紹 →': 'Renju resources →',
}
export default d
