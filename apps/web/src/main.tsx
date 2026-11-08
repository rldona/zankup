import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { queryClient } from './api';
import { App } from './App';
import { locale } from './i18n';
import './index.css';
import { createRouter } from './router';
import { installTheme } from './theme';

installTheme();
document.documentElement.lang = locale;

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <App queryClient={queryClient} router={createRouter()} offline />
  </StrictMode>,
);
