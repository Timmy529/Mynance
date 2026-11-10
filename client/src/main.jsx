import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App.jsx';
import { DataProvider, ToastProvider } from './store.jsx';
import { ConfirmProvider } from './components/ui.jsx';

// Apply a saved theme before first paint.
try {
  const t = JSON.parse(localStorage.getItem('mynance:theme') || '"system"');
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
} catch {
  /* storage unavailable */
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ToastProvider>
      <ConfirmProvider>
        <DataProvider>
          <App />
        </DataProvider>
      </ConfirmProvider>
    </ToastProvider>
  </StrictMode>,
);
