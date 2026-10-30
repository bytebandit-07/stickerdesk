import React, { useEffect, useState, useRef } from 'react';
import type { WidgetStatePayload } from '../../electron/widgetManager';

interface DragSession {
  mode: 'move' | 'resize';
  startCursorScreenX: number;
  startCursorScreenY: number;
  startWindowX: number;
  startWindowY: number;
  startWidth: number;
}

export const Widget2D: React.FC = () => {
  const [widgetState, setWidgetState] = useState<WidgetStatePayload | null>(null);
  const [serverBaseUrl, setServerBaseUrl] = useState<string>('');
  const [isHovered, setIsHovered] = useState<boolean>(false);
  const dragSessionRef = useRef<DragSession | null>(null);

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

  useEffect(() => {
    const handleWindowMouseMove = (e: MouseEvent): void => {
      const session = dragSessionRef.current;
      if (!session || !widgetState || widgetState.locked || widgetState.clickThrough) {
        return;
      }

      // If left mouse button is no longer held down, terminate session immediately
      if ((e.buttons & 1) === 0) {
        dragSessionRef.current = null;
        return;
      }

      const deltaX = e.screenX - session.startCursorScreenX;
      const deltaY = e.screenY - session.startCursorScreenY;

      if (session.mode === 'move') {
        // Strictly update X and Y only — never recompute width on move
        window.stickerdesk.setWidgetBounds(widgetState.id, {
          x: Math.round(session.startWindowX + deltaX),
          y: Math.round(session.startWindowY + deltaY),
        });
      } else if (session.mode === 'resize') {
        const nextWidth = Math.max(64, Math.min(1200, Math.round(session.startWidth + deltaX)));
        window.stickerdesk.setWidgetBounds(widgetState.id, {
          width: nextWidth,
        });
      }
    };

    const handleWindowMouseUp = (): void => {
      dragSessionRef.current = null;
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [widgetState]);

  if (!widgetState || !serverBaseUrl) {
    return null;
  }

  const handleMouseDownMove = (e: React.MouseEvent<HTMLDivElement>): void => {
    // Only initiate drag on primary left-click (button === 0)
    if (e.button !== 0 || widgetState.locked || widgetState.clickThrough) return;
    dragSessionRef.current = {
      mode: 'move',
      startCursorScreenX: e.screenX,
      startCursorScreenY: e.screenY,
      startWindowX: window.screenX,
      startWindowY: window.screenY,
      startWidth: window.innerWidth,
    };
  };

  const handleMouseDownResize = (e: React.MouseEvent<HTMLDivElement>): void => {
    e.stopPropagation();
    if (e.button !== 0 || widgetState.locked || widgetState.clickThrough) return;
    dragSessionRef.current = {
      mode: 'resize',
      startCursorScreenX: e.screenX,
      startCursorScreenY: e.screenY,
      startWindowX: window.screenX,
      startWindowY: window.screenY,
      startWidth: window.innerWidth,
    };
  };

  const handleWheelResize = (e: React.WheelEvent<HTMLDivElement>): void => {
    // Require Ctrl+Wheel and ensure no drag/resize is active to prevent trackpad auto-zoom
    if (
      !e.ctrlKey ||
      widgetState.locked ||
      widgetState.clickThrough ||
      dragSessionRef.current !== null ||
      e.buttons !== 0
    ) {
      return;
    }
    const scaleFactor = e.deltaY < 0 ? 1.06 : 0.94;
    const nextWidth = Math.max(
      64,
      Math.min(1200, Math.round(window.innerWidth * scaleFactor))
    );
    window.stickerdesk.setWidgetBounds(widgetState.id, { width: nextWidth });
  };

  const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>): void => {
    e.preventDefault();
    e.stopPropagation();
    dragSessionRef.current = null;
    window.stickerdesk.showWidgetContextMenu(widgetState.id);
  };

  const animationName =
    widgetState.settings.animation === 'float'
      ? 'stickerdesk-float 3.2s ease-in-out infinite'
      : widgetState.settings.animation === 'sway'
      ? 'stickerdesk-sway 4s ease-in-out infinite'
      : 'none';

  const showResizeHandle = isHovered && !widgetState.locked && !widgetState.clickThrough;

  return (
    <>
      <style>
        {`
          @keyframes stickerdesk-float {
            0%, 100% { transform: translateY(0px); }
            50% { transform: translateY(-8px); }
          }
          @keyframes stickerdesk-sway {
            0%, 100% { transform: rotate(0deg); }
            25% { transform: rotate(3.5deg); }
            75% { transform: rotate(-3.5deg); }
          }
        `}
      </style>

      <div
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onMouseDown={handleMouseDownMove}
        onWheel={handleWheelResize}
        onContextMenu={handleContextMenu}
        style={{
          width: '100vw',
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          boxSizing: 'border-box',
          padding: '6px',
          opacity: widgetState.opacity,
          cursor: widgetState.locked ? 'default' : 'grab',
          overflow: 'hidden',
          userSelect: 'none',
        }}
      >
        <img
          src={`${serverBaseUrl}/files/stickers/${widgetState.stickerFilePath}`}
          alt="Sticker Widget"
          draggable={false}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            pointerEvents: 'none',
            userSelect: 'none',
            animation: animationName,
          }}
        />

        {showResizeHandle && (
          <div
            onMouseDown={handleMouseDownResize}
            title="Drag to resize (or Ctrl + Scroll)"
            style={{
              position: 'absolute',
              right: '4px',
              bottom: '4px',
              width: '14px',
              height: '14px',
              borderRadius: '3px',
              backgroundColor: 'rgba(79, 70, 229, 0.9)',
              border: '1.5px solid #ffffff',
              cursor: 'nwse-resize',
              boxShadow: '0 1px 4px rgba(0,0,0,0.45)',
            }}
          />
        )}
      </div>
    </>
  );
};
