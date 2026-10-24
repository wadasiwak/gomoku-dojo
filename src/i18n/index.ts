// 全站 i18n（zh-TW 為原文、en / ja 為字典）。
//
// 設計：
//   - 原始碼裡的字串一律維持台灣繁體原文，翻譯字典以「原文」為 key：
//       t('悔棋')                         → 'Undo' / '待った'
//       t('輪到你下第 {n} 手', { n: 3 })   → 佔位符 {n} 在原文與譯文都以 vars 代入
//     字典缺鍵 → 回原文（不會出現空白或 key 字串），新字串可先上線再補翻譯。
//   - 字典依頁面分檔（src/i18n/en/*.ts、ja/*.ts），en.ts / ja.ts 彙整；
//     非 zh 才動態載入（zh 使用者不多下載一個 bundle）。
//   - 語言來源優先序：URL ?lang= → localStorage → navigator.language → zh。
//     React 元件用 useT() 訂閱（切語言整頁重繪）；非元件模組（reducer 錯誤訊息、
//     引擎標籤）直接 import { t } 即可——它們都在事件/渲染當下被呼叫。
import { useSyncExternalStore } from 'react'

export type Lang = 'zh' | 'en' | 'ja'
export type Dict = Record<string, string>
export type Vars = Record<string, string | number>

export const LANGS: { code: Lang; label: string; htmlLang: string }[] = [
  { code: 'zh', label: '中文', htmlLang: 'zh-Hant-TW' },
  { code: 'en', label: 'EN', htmlLang: 'en' },
  { code: 'ja', label: '日本語', htmlLang: 'ja' },
]

const STORAGE_KEY = 'gomoku-dojo-lang-v1'

let lang: Lang = 'zh'
let dict: Dict = {}
const listeners = new Set<() => void>()

const isLang = (x: unknown): x is Lang => x === 'zh' || x === 'en' || x === 'ja'

function detect(): Lang {
  try {
    const q = new URLSearchParams(location.search).get('lang')
    if (isLang(q)) return q
    const saved = localStorage.getItem(STORAGE_KEY)
    if (isLang(saved)) return saved
    const nav = (navigator.language || '').toLowerCase()
    if (nav.startsWith('ja')) return 'ja'
    if (nav.startsWith('en')) return 'en'
  } catch {
    /* SSR / 私密模式 */
  }
  return 'zh'
}

async function loadDict(l: Lang): Promise<Dict> {
  if (l === 'en') return (await import('./en.ts')).default
  if (l === 'ja') return (await import('./ja.ts')).default
  return {}
}

const SITE_TITLE: Record<Lang, string> = {
  zh: '五子棋道場 ⚫ 連珠禁手 × AI 對弈',
  en: 'Gomoku Dojo ⚫ Renju × AI',
  ja: '五目道場 ⚫ 連珠 × AI 対局',
}

function apply(l: Lang, d: Dict): void {
  lang = l
  dict = d
  try {
    document.documentElement.lang = LANGS.find((x) => x.code === l)!.htmlLang
    document.title = SITE_TITLE[l]
    localStorage.setItem(STORAGE_KEY, l)
  } catch {
    /* ignore */
  }
  listeners.forEach((fn) => fn())
}

/** 啟動時呼叫一次（main.tsx），確保非 zh 使用者首次渲染就是譯文。 */
export async function initLang(): Promise<void> {
  const l = detect()
  apply(l, await loadDict(l))
}

export async function setLang(l: Lang): Promise<void> {
  if (l === lang) return
  apply(l, await loadDict(l))
}

export const getLang = (): Lang => lang

function interpolate(s: string, vars?: Vars): string {
  if (!vars) return s
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))
}

/** 翻譯：zh 原文為 key，缺鍵回原文；{name} 佔位符以 vars 代入。 */
export function t(zh: string, vars?: Vars): string {
  const s = lang === 'zh' ? zh : (dict[zh] ?? zh)
  return interpolate(s, vars)
}

const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** 訂閱語言；切換時元件重繪。 */
export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang, () => 'zh' as Lang)
}

/** 元件內用：回傳已訂閱語言變化的 t。 */
export function useT(): typeof t {
  useLang()
  return t
}
