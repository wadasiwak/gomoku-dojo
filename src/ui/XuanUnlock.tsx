// 玄庫密碼框（打點複習「玄」來源與看譜頁共用）：解開後金鑰記在本機，下次免輸入。
import { useState } from 'react'
import { unlockXuan, type XuanBundle } from '../renlib/vault.ts'

export default function XuanUnlock({ onOpen }: { onOpen: (b: XuanBundle) => void }) {
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pw || busy) return
    setBusy(true)
    setErr('')
    try {
      onOpen(await unlockXuan(pw))
    } catch (x) {
      setErr(x instanceof Error ? x.message : String(x))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="panel xuan-lock" onSubmit={submit}>
      <h2>🔒 《玄》棋譜庫</h2>
      <p className="muted small">名人林書玄整理，限知道密碼的人使用（資料已加密，沒有密碼解不開）。解開一次後這台裝置會記住。</p>
      <div className="btn-row">
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="輸入密碼"
          aria-label="玄庫密碼"
          autoComplete="current-password"
        />
        <button className="btn primary" type="submit" disabled={!pw || busy}>
          {busy ? '解鎖中…' : '解鎖'}
        </button>
      </div>
      {err && <p className="msg err">{err}</p>}
    </form>
  )
}
