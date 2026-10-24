// ja 字典彙整：各頁面分檔，key＝zh-TW 原文（見 index.ts）。
import core from './ja/core.ts'
import tara from './ja/tara.ts'
import play from './ja/play.ts'
import guide from './ja/guide.ts'
import study from './ja/study.ts'
import openings from './ja/openings.ts'
import engine from './ja/engine.ts'
import type { Dict } from './index.ts'

const dict: Dict = { ...core, ...tara, ...play, ...guide, ...study, ...openings, ...engine }
export default dict
