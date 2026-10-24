// 開局圖鑑／開局書檢視／規則頁／資源頁（content/openings 的珠型名稱、傾向、簡介）。
import type { Dict } from '../index.ts'

const d: Dict = {
  // ---- 珠型名稱（EN 顯示羅馬字＋漢字；JA 沿用漢字不翻） ----
  寒星: 'Kansei 寒星',
  溪月: 'Keigetsu 溪月',
  疏星: 'Sosei 疏星',
  花月: 'Kagetsu 花月',
  殘月: 'Zangetsu 殘月',
  雨月: 'Ugetsu 雨月',
  金星: 'Kinsei 金星',
  松月: 'Shogetsu 松月',
  丘月: 'Kyugetsu 丘月',
  新月: 'Shingetsu 新月',
  瑞星: 'Zuisei 瑞星',
  山月: 'Sangetsu 山月',
  遊星: 'Yusei 遊星',
  長星: 'Chosei 長星',
  峽月: 'Kyogetsu 峽月',
  恆星: 'Kosei 恆星',
  水月: 'Suigetsu 水月',
  流星: 'Ryusei 流星',
  雲月: 'Ungetsu 雲月',
  浦月: 'Hogetsu 浦月',
  嵐月: 'Rangetsu 嵐月',
  銀月: 'Gingetsu 銀月',
  明星: 'Myojo 明星',
  斜月: 'Shagetsu 斜月',
  名月: 'Meigetsu 名月',
  彗星: 'Suisei 彗星',
  // ---- 分類／傾向 ----
  直接開局: 'Direct opening',
  間接開局: 'Indirect opening',
  直接: 'Direct',
  間接: 'Indirect',
  黑大優: 'Black much better',
  黑優: 'Black better',
  黑稍優: 'Black slightly better',
  約均衡: 'Roughly balanced',
  白稍優: 'White slightly better',
  白大優: 'White much better',
  // ---- 開局圖鑑頁 ----
  '{name}珠型': '{name} opening',
  '開局圖鑑：26 珠型': 'Opening Guide: the 26 openings',
  '連珠的前三手（黑1 天元、白2 中央 3×3、黑3 中央 5×5）經對稱歸類後恰有 26 種——直接開局（白2 直鄰）與間接開局（白2 斜鄰）各 13 種。RIF 正式規約由暫黑擺出其中一型，暫白再決定是否換邊。優劣標籤為主流研究傾向，僅供參考。':
    'The first three moves of Renju (Black 1 at the center, White 2 inside the central 3×3, Black 3 inside the central 5×5) reduce by symmetry to exactly 26 openings: 13 direct (White 2 adjacent orthogonally) and 13 indirect (White 2 adjacent diagonally). Under the official RIF rule the provisional Black sets up one of them and the provisional White decides whether to swap. The evaluation tags reflect mainstream research and are for reference only.',
  開局猜名練習: 'Opening name quiz',
  '直接開局（白2 在天元正上）': 'Direct openings (White 2 directly above the center)',
  '間接開局（白2 在天元斜上）': 'Indirect openings (White 2 diagonally above the center)',
  '{kind} 第 {n} 型': '{kind} No. {n}',
  '優劣標籤為主流研究傾向（規約換邊前的參考），實戰結果仍取決於雙方功力。':
    'The evaluation tag reflects mainstream research (a reference before the swap decision); actual results depend on the players.',
  用此開局對弈: 'Play from this opening',
  載入擺譜: 'Open in study board',
  回圖鑑: 'Back to guide',
  開局猜名: 'Name the opening',
  '看前三手珠型，猜出它的名字。答對': 'Look at the first three moves and guess the name. Correct',
  猜名珠型: 'Opening to name',
  '答對了！': 'Correct!',
  '不對，這是「{name}」。': 'No, this is {name}.',
  '{kind}開局第 {n} 型': '{kind} opening No. {n}',
  下一題: 'Next',
  看詳情: 'Details',
  // ---- 珠型簡介 ----
  '三子沿中線疊成一直排，黑第 3 手隔著白子與天元相望，左右完全對稱。黑可向兩翼任意展開攻勢，主流研究認為黑大優、甚至有黑必勝的定論；正式規約下暫白幾乎都會選擇換邊。':
    'Three stones stacked on the center line, Black 3 facing the center across the white stone, fully symmetric left and right. Black can attack on either wing; mainstream research rates it Black much better, even a forced Black win. Under the official rule the provisional White almost always swaps.',
  '白2 在天元正上方，黑3 斜貼白子右上。黑棋形靈活、攻路多，定式研究認為黑方攻勢難以抵擋，主流視為黑大優並常列入黑必勝討論；規約實戰中暫白多半直接換邊。':
    'White 2 directly above the center, Black 3 diagonally touching the white stone at its upper right. Black’s shape is flexible with many attacking lines; theory considers the attack hard to stop, rated Black much better and often discussed as a Black win. In rule play the provisional White usually swaps.',
  '黑3 跳到天元右上斜隔一路處，三子互不接觸、棋形鬆散。攻勢不若花月、浦月鋒利，但局面均衡有彈性，一般認為大致兩分、白方略可滿意，是正式規約下暫黑常選的安全開局之一。':
    'Black 3 jumps one point diagonally up-right of the center; the three stones do not touch and the shape is loose. Less sharp than Kagetsu or Hogetsu, but balanced and flexible. Generally considered about even, slightly comfortable for White, and a common safe choice for the provisional Black under the official rule.',
  '黑3 緊貼白2 右側、位於天元右上斜鄰，是名氣最大的珠型之一。黑方攻勢兇猛、變化雖繁但結論明確，主流研究普遍認為黑必勝已成定論；規約下暫白幾乎必換邊，實戰多作讓先或研究題材。':
    'Black 3 touches White 2 on its right, diagonally adjacent to the center; one of the most famous openings. Black’s attack is fierce and, though the variations are many, the verdict is clear: mainstream research treats it as a settled Black win. Under the rule the provisional White nearly always swaps; in practice it appears in handicap games and study.',
  '黑3 落在天元右上方的日字位（桂馬跳）。黑棋形帶斜線潛力、攻守兼備，一般認為黑方優勢明顯但不若花月極端，仍留有實戰空間；規約下暫白通常傾向換邊，黑方需備妥讓先腹案。':
    'Black 3 lands a knight’s move up-right of the center. The shape has diagonal potential and balances attack and defense; Black is clearly better but not as extreme as Kagetsu, so practical play remains. The provisional White usually leans toward swapping, so Black should prepare plans for playing White.',
  '黑3 在天元右鄰、與白2 斜對，兩枚黑子橫向相連成中心厚勢。黑的攻擊點豐富、節奏也快，主流研究認為黑大優並常列入黑必勝討論；規約實戰中白方多半選擇換邊。':
    'Black 3 right next to the center, diagonal to White 2; the two black stones form a thick horizontal pair in the middle. Black has rich attacking points and a fast tempo; rated Black much better and often discussed as a Black win. In rule play White usually swaps.',
  '黑3 在天元右方隔一路，兩枚黑子橫向跳開、涵蓋面寬，可雙翼展開。主流研究認為黑大優、亦有黑必勝結論之說，是直接開局中黑方火力很強的珠型；規約下暫白通常直接換邊。':
    'Black 3 one point to the right of the center with a gap; the two black stones are spread wide and can expand on both wings. Rated Black much better, with some claiming a forced Black win; one of the most powerful direct openings for Black. The provisional White usually swaps.',
  '黑3 在天元正下方，兩枚黑子縱向相連、白子壓在頂端，左右對稱。棋形穩健厚實，攻擊不如星月類珠型激烈，一般認為黑稍優；規約下換邊與否常取決於棋手風格，實戰出現率不低。':
    'Black 3 directly below the center; the two black stones connect vertically with the white stone capping the top, symmetric left and right. Solid and thick, less violent than the star/moon openings; generally Black slightly better. Whether to swap often depends on style, and it appears fairly often in practice.',
  '黑3 斜貼天元右下方，與上方的白2 一縱一斜錯開。黑形厚實但攻勢平緩，變化相對平穩，一般認為黑稍優，是規約下暫黑可以考慮的低風險選擇之一，也常見於讓先研究。':
    'Black 3 diagonally touching the center at its lower right, offset from White 2 above. Thick shape but a gentle attack and calm variations; generally Black slightly better. A low-risk option for the provisional Black under the rule, also common in handicap study.',
  '黑3 落在天元右下方的日字位，斜線與橫線都留有發展空間，後續定式研究相當深。攻守資源平均、實戰內容豐富，一般認為黑方有優勢；規約對局中屬於熱門珠型，暫白換邊與否見仁見智。':
    'Black 3 lands a knight’s move down-right of the center, leaving room on both the diagonal and the row; the theory runs deep. Attack and defense resources are balanced and the play is rich; generally Black better. A popular opening in rule play, where opinions differ on whether to swap.',
  '黑3 在天元正下方隔一路，三子成中線上的鬆散縱列，左右對稱。棋形平穩、即戰攻擊點少，一般認為接近兩分或黑略好，是暫黑用來避免被換邊吃虧的均衡選擇，實戰多走向細棋。':
    'Black 3 one point below the center with a gap; the three stones form a loose column on the center line, symmetric left and right. Calm shape with few immediate attacking points; generally about even or slightly better for Black. A balanced choice for the provisional Black to avoid losing by swap; games tend to be subtle.',
  '黑3 落在天元右下方的縱向日字位，兼具斜線與縱線的雙重發展空間，攻勢不俗、定式研究也深。一般認為黑方優勢；規約下暫白多會認真考慮換邊，黑方應準備讓先方案。':
    'Black 3 lands a vertical knight’s move down-right of the center, with development on both the diagonal and the column; a decent attack and deep theory. Generally Black better; the provisional White seriously considers swapping, so Black should prepare plans for playing White.',
  '黑3 跳到天元右下斜隔一路，與白2 分處天元兩側，黑子彼此失聯、難以協同作戰。主流研究認為白大優、甚至有白必勝之說，是黑方最差的珠型之一；規約下暫黑幾乎不會主動擺出此型。':
    'Black 3 jumps one point diagonally down-right of the center, on the opposite side from White 2; the black stones are disconnected and cannot cooperate. Rated White much better, some even claim a forced White win; one of the worst openings for Black. The provisional Black almost never chooses it.',
  '三子沿同一條斜線排開，黑1、黑3 隔著白2 相望，與寒星互為縱斜對應。斜線的張力比中線弱，黑攻勢不易成形，一般認為大致兩分、白方略舒服，是規約下暫黑的均衡選項之一。':
    'Three stones on one diagonal, Black 1 and Black 3 facing each other across White 2, the diagonal counterpart of Kansei. The diagonal has less tension than the center line and Black’s attack is hard to build; generally about even, slightly comfortable for White. A balanced option for the provisional Black.',
  '白2 斜鄰天元，黑3 橫貼在白2 右側。黑的攻擊點集中於右翼、可借白子借力成形，主流研究認為黑大優並常列入黑必勝討論；正式規約下暫白多半直接換邊，實戰少見黑方真正執行此型。':
    'White 2 diagonally adjacent to the center, Black 3 touching White 2 on its right. Black’s attacking points concentrate on the right wing and can use the white stone for shape; rated Black much better and often discussed as a Black win. The provisional White usually swaps, so Black rarely gets to play it.',
  '黑3 在天元右方隔一路、斜貼白2 右下。黑橫向跳二配合中心厚勢，攻守路線清晰、定式結論明確，主流視為黑大優的代表珠型之一；規約下白方幾乎必然換邊。':
    'Black 3 one point to the right of the center with a gap, diagonally touching White 2 at its lower right. The horizontal jump combines with central thickness; attack and defense lines are clear and the theory is settled. A representative Black-much-better opening; White almost always swaps.',
  '黑3 落在天元右下方的日字位，斜線與橫線攻勢可以互相支援，是間接開局中的著名強型。主流研究普遍認為黑大優，黑必勝的定論流傳已久；規約下多作讓先與研究題材使用。':
    'Black 3 lands a knight’s move down-right of the center; the diagonal and horizontal attacks support each other. A famous strong indirect opening, widely rated Black much better with a long-standing verdict of a Black win; mostly used for handicap games and study.',
  '黑3 跳到天元右下斜隔一路，與白2 拉成對角，是黑子彼此距離最遠的珠型之一。黑難以形成合力、白反而好整以暇，一般認為白略優；規約下偶見暫黑用它引誘對手不換邊。':
    'Black 3 jumps one point diagonally down-right of the center, on the opposite diagonal from White 2; the black stones are among the farthest apart of any opening. Black struggles to coordinate while White sits comfortably; generally White slightly better. Occasionally chosen by the provisional Black to tempt the opponent not to swap.',
  '黑3 在天元右鄰、恰在白2 正下方，兩枚黑子橫向相連且壓住白子出路。黑的攻擊資源豐富、成形速度快，主流認為黑大優、亦有黑必勝結論之說；規約實戰中白方多選擇換邊。':
    'Black 3 right next to the center and directly below White 2; the two black stones connect horizontally and block the white stone. Black has rich attacking resources and builds shape quickly; rated Black much better, some claim a forced win. In rule play White usually swaps.',
  '黑3 在天元右下斜鄰，與白2 隔一點縱向相對。黑方斜線火力全開，與花月並稱兩大最強珠型，黑必勝已是主流定論；規約下白方必然換邊，此型多用於讓先對局與詰棋研究。':
    'Black 3 diagonally adjacent to the center at its lower right, facing White 2 vertically across one point. Black’s diagonal firepower is at full strength; together with Kagetsu it is one of the two strongest openings, and a Black win is the mainstream verdict. White always swaps; the opening is used for handicap games and problem study.',
  '黑3 落在天元右下的縱向日字位、白2 正下方隔兩路。黑的縱線與斜線互為犄角、攻勢連貫，主流研究認為黑大優、亦有黑必勝之說；規約下暫白通常選擇換邊。':
    'Black 3 lands a vertical knight’s move down-right of the center, two points below White 2. Black’s column and diagonal support each other and the attack flows; rated Black much better, some claim a forced win. The provisional White usually swaps.',
  '黑3 在天元正下方，與白2 斜對、三子構成一道折線。棋形均衡中帶攻勢，定式研究極深、雙方都有可下之處，一般認為黑優但仍有實戰空間，是規約對局中出現率很高的珠型。':
    'Black 3 directly below the center, diagonal to White 2; the three stones form a bent line. Balanced with attacking chances, extremely deep theory and play for both sides; generally Black better but with real practical scope. One of the most frequent openings in rule play.',
  '黑3 在天元正下方隔一路，與白2 遙遙斜對。黑的中線縱向潛力配合斜線轉換相當難防，主流研究認為黑大優、常列入黑必勝討論；規約下白方多半換邊，黑方需熟讓先變化。':
    'Black 3 one point below the center with a gap, far diagonal from White 2. Black’s vertical potential on the center line combined with diagonal switches is hard to defend; rated Black much better and often discussed as a Black win. White usually swaps, so Black must know the lines for playing White.',
  '黑3 斜貼天元左下，與黑1、白2 連成同一條斜線、兩枚黑子相連。棋形緊湊，但斜線的一頭已被白子壓住，攻勢受限，一般認為黑略好、內容大致均衡，是規約下的中性選擇之一。':
    'Black 3 diagonally touching the center at its lower left, on the same diagonal as Black 1 and White 2, the two black stones connected. Compact, but one end of the diagonal is already capped by White and the attack is limited; generally slightly better for Black, roughly balanced. A neutral choice under the rule.',
  '黑3 落在天元左下方的日字位、位於白2 的斜對側。黑形舒展，斜線與縱線皆留有後續手段，一般認為黑方優勢、變化也富實戰性；規約下暫白常會換邊，黑方需備讓先腹案。':
    'Black 3 lands a knight’s move down-left of the center, on the opposite side from White 2. An open shape with follow-ups on both the diagonal and the column; generally Black better with practical variations. The provisional White often swaps, so Black should prepare plans for playing White.',
  '黑3 沿白2－天元的斜線反向跳隔一路，三子同線但黑子彼此脫節。黑既難搶先手攻點、又背著禁手包袱，主流研究認為白大優、白必勝之說流傳最廣；暫黑實戰幾乎不會採用。':
    'Black 3 jumps the other way along the White 2 to center diagonal with a gap; all three stones share the line but the black stones are disconnected. Black can neither seize the initiative nor shed the burden of forbidden moves; rated White much better, with a forced White win the most widely held view. The provisional Black almost never uses it.',
  // ---- 開局書檢視（隱藏頁） ----
  空盤: 'empty board',
  '書局面 {key}': 'Book position {key}',
  '第 {n} 手局面 → 建議{c}': 'Position after move {n} → suggested {c}',
  '分數 {s}（行棋方視角）・深度 {d}': 'Score {s} (side to move) · depth {d}',
  '{n} 手×{c}': '{n} moves ×{c}',
  開局書檢視: 'Opening Book Explorer',
  '隱藏頁（不在導覽列）。書由 {engine} {version}（{commit}）離線深算 {sec}s/局面產生，共':
    'Hidden page (not in the nav). The book was generated offline by {engine} {version} ({commit}) at {sec}s per position, with',
  '局面；手數分布：{len}——最深為第 8 手局面，即建議到第 9 手。分數為行棋方視角；每筆建議手皆經本站引擎合法性雙驗。對局中 AI 的中局書手僅最高難度採用；規約兩打／擇打評值各難度皆用書值。':
    'positions in total; distribution: {len}. The deepest entries are move-8 positions, i.e. suggestions up to move 9. Scores are from the side to move; every suggestion is double-checked for legality by this site’s engine. In games only the top level uses the book for middlegame moves; the two-offer / choice evaluations use book values at every level.',
  '自由模式／其他': 'Free mode / other',
  '{n} 局面': '{n} positions',
  // ---- 規則頁 ----
  連珠禁手速覽: 'Renju Forbidden Moves at a Glance',
  '連珠規則裡只有黑棋有禁手；踩禁手判負，但同一手若同時成「恰好五連」則黑勝（五連豁免）。白棋無禁手、長連也算勝。下面 ✕ 的判定由本站引擎現場計算。':
    'In Renju only Black has forbidden moves; playing one loses, unless the same move also makes exactly five in a row, in which case Black wins (the five exemption). White has no restrictions and an overline also wins for White. The ✕ verdicts below are computed live by this site’s engine.',
  '黑棋一手連成六子以上（白棋長連算勝，黑棋是禁手）。圖中 ✕ 補下去就是六連。':
    'Black makes six or more in a row with one move (an overline wins for White but is forbidden for Black). Playing ✕ here makes six.',
  '黑棋一手同時做出兩個以上「真活三」。圖中 ✕ 同時成橫、直兩個活三。':
    'Black makes two or more genuine open threes with one move. Playing ✕ here makes an open three both horizontally and vertically.',
  '黑棋一手同時做出兩個以上的四（含同一直線上的跳四）。圖中 ✕ 橫直各成一個四。':
    'Black makes two or more fours with one move (including split fours on the same line). Playing ✕ here makes a four horizontally and another vertically.',
  '引擎判定：': 'Engine verdict: ',
  非禁手: 'not forbidden',
  '{title}例圖': '{title} example',
  '活三的「真活性」是遞迴判定的：能延伸成活四的點若本身是禁手，該三不算活三——引擎與題庫都依這套嚴格定義。':
    'Whether a three is genuinely open is decided recursively: if the point that would extend it to an open four is itself forbidden, the three does not count as open. The engine and the puzzles both follow this strict definition.',
  完整規則: 'Full rules',
  '以下四節轉載自台灣連珠推廣站《規則》（經站方同意收錄，文字逐字照錄）。原站若有更新以':
    'The four sections below are reproduced from the Rules pages of the Taiwan Renju site (with permission, quoted verbatim). If the original is updated, the',
  原站: 'original site',
  '為準。RIF 官方規則全文與更多外部資源見': 'prevails. For the official RIF rules and more external resources see the',
  資源頁: 'resources page',
  '。': '.',
  '（以下規則全文為中文原文引用）': 'The following is quoted in Chinese from the Taiwan Renju site (with permission).',
  行棋規則: 'Rules of play',
  有禁開局規則: 'Opening rules (Renju)',
  無禁開局規則: 'Opening rules (Gomoku)',
  其他玩法: 'Other variants',
  '出處：': 'Source: ',
  // ---- 資源頁 ----
  連珠資源: 'Renju Resources',
  '想往下鑽研的三個外部站：官方規則與職業對局、台灣中文教學與賽事、線上引擎分析。內容屬各站所有，本站僅介紹與連結（規則全文除外，見下方聲明）。':
    'Three external sites for going deeper: official rules and professional games, Taiwanese Chinese-language tutorials and events, and online engine analysis. Content belongs to each site; we only describe and link (except the full rules text, see the note below).',
  'RIF 國際連珠聯盟': 'Renju International Federation (RIF)',
  '連珠世界的官方樞紐：RIF 正式規則全文與 26 珠型定義、世界排名、國際賽事紀錄，以及十五萬局以上的職業對局資料庫（下載授權為非商業、僅限離線研究）。查權威規則與職業實戰，以這裡為準。':
    'The official hub of the Renju world: the full RIF rules and the 26 opening definitions, world rankings, international tournament records, and a database of over 150,000 professional games (download licensed for non-commercial offline research only). The authority for rules and professional play.',
  官方規則: 'Official rules',
  對局資料庫: 'Game database',
  世界排名: 'World rankings',
  台灣連珠推廣: 'Taiwan Renju Promotion',
  '台灣本土的連珠推廣站：中文教學文章由淺入深，還有國內賽事公告與段位資訊。想循中文教材入門、找同好或報名比賽，從這裡開始。其《規則》四頁已經站方同意收錄於本站規則頁。':
    'Taiwan’s local Renju promotion site: Chinese tutorials from beginner to advanced, plus domestic tournament announcements and rank information. Start here to learn from Chinese materials, find fellow players or enter events. Its four Rules pages are reproduced on our rules page with permission.',
  中文教學: 'Chinese tutorials',
  賽事公告: 'Tournaments',
  段位: 'Ranks',
  '線上 Rapfi 分析（五子棋計算器）': 'Online Rapfi analysis (Gomoku Calculator)',
  '瀏覽器裡直接用的強力分析工具，背後是 Gomocup 冠軍級的 Rapfi 引擎（NNUE 評估）。本站「Rapfi 分析」掛載的就是同一顆引擎的 WASM 版；需要更完整的分析介面（多變化、無限思考）可以去 gomocalc。':
    'A powerful analysis tool that runs in the browser, powered by the Gomocup champion-class Rapfi engine (NNUE evaluation). Our "Rapfi analysis" loads the WASM build of the same engine; for a fuller interface (multiple variations, unlimited thinking) go to gomocalc.',
  引擎分析: 'Engine analysis',
  免安裝: 'No install',
  本站與外部資源的關係: 'How this site relates to external resources',
  '本站的開局書與題庫皆由本站引擎自行計算產生，未使用 renju.net 對局資料庫的內容上站（該資料庫授權為非商業且僅限離線使用）；外部網站的文章與棋譜屬原站所有，本站僅連結、不轉載；唯一例外是':
    'Our opening book and puzzles are computed by our own engine; no content from the renju.net game database is published here (that database is licensed for non-commercial offline use only). Articles and game records on external sites belong to them; we only link, never republish. The one exception is the full rules text on the ',
  規則頁: 'rules page',
  '的規則全文，經 587.renju.org.tw 站方同意收錄。': ', reproduced with the permission of 587.renju.org.tw.',
  '站內「Rapfi 分析」功能掛載未經修改的': 'The "Rapfi analysis" feature loads the unmodified',
  '引擎（© dhbloo，GPL-3.0，自行編譯為 WASM）；本站的規則引擎與對弈 AI 為獨立原創實作。':
    'engine (© dhbloo, GPL-3.0, compiled to WASM by us); the rules engine and playing AI of this site are independent original implementations.',
}
export default d
