import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import type { WidgetStatePayload } from '../../electron/widgetManager';
import { Widget2D } from './Widget2D';
import { Widget3D } from './Widget3D';

const WidgetRoot: React.FC = () => {
  const [widgetState, setWidgetState] = useState<WidgetStatePayload | null>(null);
  const [serverBaseUrl, setServerBaseUrl] = useState<string>('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const widgetId = params.get('widgetId');
    if (!widgetId) return;

    const init = async (): Promise<void> => {
      const [config, state] = await Promise.all([
        window.stickerdesk.getServerConfig(),
        window.stickerdesk.getWidgetState(widgetId),
      ]);
      setServerBaseUrl(config.baseUrl);
      if (state) {
        setWidgetState(state);
      }
    };

    void init();

    const unsubscribe = window.stickerdesk.onWidgetStateUpdated((updated) => {
      if (updated.id === widgetId) {
        setWidgetState(updated);
      }
    });

    return unsubscribe;
  }, []);

  if (!widgetState || !serverBaseUrl) {
    return null;
  }

  return widgetState.mode === '3d' ? (
    <Widget3D widgetState={widgetState} serverBaseUrl={serverBaseUrl} />
  ) : (
    <Widget2D widgetState={widgetState} serverBaseUrl={serverBaseUrl} />
  );
};

const rootEl = document.getElementById('widget-root');
if (!rootEl) {
  throw new Error('Missing #widget-root element in widget.html');
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <WidgetRoot />
  </React.StrictMode>
);
