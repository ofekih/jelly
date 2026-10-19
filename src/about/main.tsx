import React from 'react';
import ReactDOM from 'react-dom/client';
import 'katex/dist/katex.min.css';
import '../index.css';
import { readLocalSettings } from '../lib/localSettings';
import { AboutPage } from './AboutPage';

// Same theme as the app: the saved setting, else the system preference
const { darkMode } = readLocalSettings();
document.documentElement.classList.toggle(
  'dark',
  darkMode ?? window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AboutPage />
  </React.StrictMode>
);
