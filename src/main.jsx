import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Nexora from './Nexora.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Nexora />
  </StrictMode>,
)
