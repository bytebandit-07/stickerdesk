import React from 'react';
import { OutlineOptions } from '../../lib/image/outline';

interface OutlineControlsProps {
  options: OutlineOptions;
  onChange: (updated: OutlineOptions) => void;
}

export const OutlineControls: React.FC<OutlineControlsProps> = ({ options, onChange }) => {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        padding: '16px',
        backgroundColor: '#1e1e1e',
        borderRadius: '8px',
        border: '1px solid #2e2e2e',
      }}
    >
      <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600, color: '#f3f4f6' }}>
        3. Die-Cut Outline
      </h3>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
          <span style={{ color: '#ccc' }}>Outline Dilation</span>
          <span style={{ color: '#fff', fontWeight: 600 }}>{options.thickness} px</span>
        </div>
        <input
          type="range"
          min={0}
          max={40}
          step={1}
          value={options.thickness}
          onChange={(e) =>
            onChange({
              ...options,
              thickness: Number(e.target.value),
            })
          }
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '0.82rem', color: '#ccc' }}>Outline Color</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input
            type="color"
            value={options.color}
            onChange={(e) =>
              onChange({
                ...options,
                color: e.target.value,
              })
            }
            style={{
              width: '32px',
              height: '28px',
              border: 'none',
              padding: 0,
              backgroundColor: 'transparent',
              cursor: 'pointer',
            }}
          />
          <span style={{ fontSize: '0.8rem', fontFamily: 'monospace', color: '#aaa' }}>
            {options.color.toUpperCase()}
          </span>
        </div>
      </div>

      <hr style={{ border: 'none', borderTop: '1px solid #2e2e2e', margin: '2px 0' }} />

      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          fontSize: '0.85rem',
          color: '#e5e7eb',
        }}
      >
        <span>Drop Shadow</span>
        <input
          type="checkbox"
          checked={options.dropShadow}
          onChange={(e) =>
            onChange({
              ...options,
              dropShadow: e.target.checked,
            })
          }
        />
      </label>

      {options.dropShadow && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', paddingLeft: '4px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem' }}>
              <span style={{ color: '#aaa' }}>Shadow Blur</span>
              <span>{options.shadowBlur} px</span>
            </div>
            <input
              type="range"
              min={0}
              max={30}
              value={options.shadowBlur}
              onChange={(e) =>
                onChange({
                  ...options,
                  shadowBlur: Number(e.target.value),
                })
              }
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem' }}>
              <span style={{ color: '#aaa' }}>Vertical Offset</span>
              <span>{options.shadowOffsetY} px</span>
            </div>
            <input
              type="range"
              min={0}
              max={20}
              value={options.shadowOffsetY}
              onChange={(e) =>
                onChange({
                  ...options,
                  shadowOffsetY: Number(e.target.value),
                })
              }
            />
          </div>
        </div>
      )}
    </div>
  );
};
