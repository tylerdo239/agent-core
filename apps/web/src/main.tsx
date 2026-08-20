// apps/web/src/main.tsx — Phase 9.4 entrypoint.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import './style.css'

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('main.tsx: #root not found')

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
