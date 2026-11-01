import React from 'react'
import ReactDOM from 'react-dom/client'
// Plus Jakarta Sans, self-hosted: the woff2 files are bundled and precached by the PWA, so the font works offline.
import '@fontsource-variable/plus-jakarta-sans/wght.css'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
