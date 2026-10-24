import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initLang } from './i18n/index.ts'

// 先定語言（非 zh 要先載字典）再掛 React，避免首屏閃中文。
initLang().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
