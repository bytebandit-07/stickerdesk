import React from 'react';
import ReactDOM from 'react-dom/client';
import { Widget2D } from './Widget2D';

const rootEl = document.getElementById('widget-root');
if (!rootEl) {
  throw new Error('Missing #widget-root element in widget.html');
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <Widget2D />
  </React.StrictMode>
);
