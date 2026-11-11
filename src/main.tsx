import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

// State is read from the hash once at startup, so a link pasted into an open
// tab needs a fresh start to take effect. (replaceState doesn't fire this.)
window.addEventListener('hashchange', () => window.location.reload())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
