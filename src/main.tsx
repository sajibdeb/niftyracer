import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import '@fortawesome/fontawesome-free/css/all.min.css'
import { PrivyProviderWrapper } from './PrivyConfig'
import { initFarcaster } from './lib/farcaster'

// Initialize Farcaster SDK for miniapp support
initFarcaster()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PrivyProviderWrapper>
      <App />
    </PrivyProviderWrapper>
  </React.StrictMode>,
)