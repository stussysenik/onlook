import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { startOnlookBridge } from '@onlook-next/react-live-bridge/runtime';

import App from './App';
import './index.css';

startOnlookBridge();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
