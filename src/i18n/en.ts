// en 字典彙整：各頁面分檔，key＝zh-TW 原文（見 index.ts）。
import core from './en/core.ts'
import tara from './en/tara.ts'
import play from './en/play.ts'
import guide from './en/guide.ts'
import study from './en/study.ts'
import openings from './en/openings.ts'
import engine from './en/engine.ts'
import type { Dict } from './index.ts'

const dict: Dict = { ...core, ...tara, ...play, ...guide, ...study, ...openings, ...engine }
export default dict
