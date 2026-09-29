import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { restoreLocaleThenRender } from './ui/boot';
import { appStore } from './ui/state/store';
import './ui/theme.css';

// The saved interface language (loads its dictionary chunk) is applied before the first render,
// so a Turkish visitor never sees the English text flash.
void restoreLocaleThenRender(appStore, () => {
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
