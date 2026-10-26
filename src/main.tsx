import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import './dark.css'
import { applyUiTheme, initialUiTheme } from './theme'
import { applyAiIndicatorMotion, initialAiIndicatorMotion } from './aiIndicatorMotion'

applyUiTheme(initialUiTheme())
applyAiIndicatorMotion(initialAiIndicatorMotion())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
