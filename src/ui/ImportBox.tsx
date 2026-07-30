// 匯入棋譜輸入框：textarea 貼上 → parseImport 嚴格驗證 → navigate 進
// 重播（#/replay/<棋譜>）或擺譜（#/study/<棋譜>），靠 App 的 route key remount。
// 錯誤（含「第幾手壞掉」）行內顯示、不跳頁。
import { useState } from 'react'
import { parseImport } from './importRecord.ts'
import { navigate } from '../router.ts'
import type { Rule } from '../engine/types.ts'

export default function ImportBox({ target }: { target: 'replay' | 'study' }) {
  const [text, setText] = useState('')
  const [rule, setRule] = useState<Rule>('renju')
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    const r = parseImport(text, rule)
    if (!r.ok) {
      setError(r.error)
      return
    }
    setError(null)
    navigate(`${target}/${r.serialized}`)
  }

  return (
    <div className="import-box">
      <textarea
        rows={3}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setError(null)
        }}
        aria-label="貼上棋譜"
        placeholder={'本站棋譜（r1:hhhgii… / r2:…）或座標序列（h8 i9 g9，行 1 在最下；\n逗號／空白／換行分隔、大小寫皆可）'}
      />
      <div className="btn-row">
        <select
          value={rule}
          onChange={(e) => setRule(e.target.value as Rule)}
          aria-label="匯入規則"
        >
          <option value="renju">連珠（黑有禁手）</option>
          <option value="gomoku">無禁手五子棋</option>
        </select>
        <button className="btn primary" onClick={submit}>
          {target === 'replay' ? '匯入重播' : '載入擺譜'}
        </button>
      </div>
      <p className="muted small">
        座標序列以上方規則逐手驗證（重複／越界／終局後多餘著手都會指出第幾手）；
        本站棋譜自帶規則、忽略此選項。
      </p>
      {error && (
        <p className="msg err import-err" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
