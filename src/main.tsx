import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { appStore } from './ui/state/store';
import './ui/theme.css';

// apply the interface language chosen on a previous visit (loads its dictionary chunk)
void appStore.actions.restoreLocale();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
