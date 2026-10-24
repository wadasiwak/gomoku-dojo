// 《玄》資料加密保管：名人林書玄的庫只給知道密碼的人看（站與 repo 都是公開的，
// 前端擋密碼框沒用——資料檔本身要加密，沒密碼解不開）。
//
// 檔案格式 public/xuan/xuan.vault：
//   "XUAN1"(5) ｜ salt(16) ｜ iv(12) ｜ AES-256-GCM 密文
//   金鑰＝PBKDF2-SHA256(密碼, salt, 600000 次)；GCM 驗證失敗＝密碼錯。
//   明文＝gzip( 庫長度 u32 LE ｜ .lib 位元組 ｜ xuan-data.json 的 UTF-8 )
// 解開後把金鑰原始位元組（不是密碼）存在 localStorage，下次免輸入；「鎖上」即清掉。
// 加密在 scripts/build-xuan.mjs（node 端同一份程式），密碼從環境變數 XUAN_PASSWORD 給，不進 repo。
import { t } from '../i18n/index.ts'
import type { GuideItem } from '../guide/quiz.ts'

const MAGIC = 'XUAN1'
const ITER = 600_000
const KEY_STORE = 'gomoku-dojo-xuan-key'

export interface XuanBundle {
  lib: Uint8Array
  items: GuideItem[]
}

const subtle = () => globalThis.crypto.subtle

async function deriveKey(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const base = await subtle().importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: ITER }, base, 256)
  return new Uint8Array(bits)
}

const aesKey = (raw: Uint8Array) => subtle().importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt'])

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([data as BlobPart]).stream().pipeThrough(stream))
  return new Uint8Array(await out.arrayBuffer())
}

/** build 腳本用：庫＋打點資料 → 加密檔。 */
export async function sealXuan(lib: Uint8Array, items: GuideItem[], password: string): Promise<Uint8Array> {
  const json = new TextEncoder().encode(JSON.stringify(items))
  const plain = new Uint8Array(4 + lib.length + json.length)
  new DataView(plain.buffer).setUint32(0, lib.length, true)
  plain.set(lib, 4)
  plain.set(json, 4 + lib.length)
  const gz = await pipe(plain, new CompressionStream('gzip'))
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16))
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
  const key = await aesKey(await deriveKey(password, salt))
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, gz as BufferSource))
  const out = new Uint8Array(MAGIC.length + 16 + 12 + ct.length)
  out.set(new TextEncoder().encode(MAGIC), 0)
  out.set(salt, 5)
  out.set(iv, 21)
  out.set(ct, 33)
  return out
}

/** 用金鑰原始位元組解開；密碼錯（GCM 驗證失敗）丟 Error('密碼不對')。 */
async function openWithKey(file: Uint8Array, raw: Uint8Array): Promise<XuanBundle> {
  if (new TextDecoder().decode(file.subarray(0, 5)) !== MAGIC) throw new Error(t('玄庫檔案格式不對'))
  let gz: Uint8Array
  try {
    gz = new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: file.subarray(21, 33) as BufferSource }, await aesKey(raw), file.subarray(33) as BufferSource))
  } catch {
    throw new Error(t('密碼不對'))
  }
  const plain = await pipe(gz, new DecompressionStream('gzip'))
  const n = new DataView(plain.buffer, plain.byteOffset).getUint32(0, true)
  return {
    lib: plain.subarray(4, 4 + n),
    items: JSON.parse(new TextDecoder().decode(plain.subarray(4 + n))) as GuideItem[],
  }
}

export async function openXuan(file: Uint8Array, password: string): Promise<{ bundle: XuanBundle; key: Uint8Array }> {
  const key = await deriveKey(password, file.subarray(5, 21))
  return { bundle: await openWithKey(file, key), key }
}

// ---- 瀏覽器端：抓檔＋記住金鑰（同一頁面只解一次，打點頁與看譜頁共用）----
let fileP: Promise<Uint8Array> | null = null
let opened: XuanBundle | null = null

function fetchVault(): Promise<Uint8Array> {
  fileP ??= fetch(`${import.meta.env.BASE_URL}xuan/xuan.vault`).then(async (r) => {
    if (!r.ok) throw new Error(t('玄庫下載失敗 HTTP {status}', { status: r.status }))
    return new Uint8Array(await r.arrayBuffer())
  })
  fileP.catch(() => (fileP = null))
  return fileP
}

const toHex = (u: Uint8Array) => [...u].map((b) => b.toString(16).padStart(2, '0')).join('')
const fromHex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16))

/** 已解開過（本頁或 localStorage 記住的金鑰）就直接給；否則回 null（要問密碼）。 */
export async function xuanIfUnlocked(): Promise<XuanBundle | null> {
  if (opened) return opened
  const saved = localStorage.getItem(KEY_STORE)
  if (!saved) return null
  try {
    opened = await openWithKey(await fetchVault(), fromHex(saved))
    return opened
  } catch {
    localStorage.removeItem(KEY_STORE) // 庫換了密碼／金鑰壞了：重問
    return null
  }
}

export async function unlockXuan(password: string): Promise<XuanBundle> {
  const { bundle, key } = await openXuan(await fetchVault(), password)
  localStorage.setItem(KEY_STORE, toHex(key))
  opened = bundle
  return bundle
}

export function lockXuan(): void {
  localStorage.removeItem(KEY_STORE)
  opened = null
}
