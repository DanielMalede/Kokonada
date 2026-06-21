import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { store } from './store'
import { ThemeProvider } from './context/ThemeProvider'
import { TooltipProvider } from './components/ui/tooltip'
import { Toaster } from './components/ui/sonner'
import './index.css'
import App from './App.tsx'

// Apply the persisted Emotion Aura preference before first paint.
if (localStorage.getItem('koko-aura') === '0') {
  document.documentElement.classList.add('aura-off')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Provider store={store}>
      <ThemeProvider>
        <TooltipProvider delayDuration={200}>
          <App />
          <Toaster position="top-center" richColors />
        </TooltipProvider>
      </ThemeProvider>
    </Provider>
  </StrictMode>,
)
