'use client';

import { useEffect, useRef, useState } from 'react';

/** A single extra slider setting appended below the built-in volume control. */
export interface SliderSetting {
  /** Stable key (used for React keys / labels). */
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  /** Optional formatter for the value readout (e.g. percentage). */
  format?: (v: number) => string;
}

interface SettingsMenuProps {
  /** Current volume 0–1. */
  volume: number;
  onVolumeChange: (v: number) => void;
  /** Extra game-specific settings (e.g. DDZ played-card size). */
  extraSettings?: SliderSetting[];
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function SliderRow({ setting }: { setting: SliderSetting }) {
  const readout = setting.format ? setting.format(setting.value) : undefined;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-white/80 text-xs font-medium">{setting.label}</span>
        {readout && <span className="text-white/50 text-[11px] tabular-nums">{readout}</span>}
      </div>
      <input
        type="range"
        min={setting.min}
        max={setting.max}
        step={setting.step}
        value={setting.value}
        onChange={(e) => setting.onChange(parseFloat(e.target.value))}
        className="w-full accent-yellow-400 cursor-pointer"
        aria-label={setting.label}
      />
    </div>
  );
}

/**
 * Top-right gear button that opens a popover list of settings. Volume is always
 * present; callers may append game-specific sliders via `extraSettings`. Same
 * behaviour on desktop and mobile (a tap/click toggles the popover).
 */
export function SettingsMenu({ volume, onVolumeChange, extraSettings = [] }: SettingsMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="fixed top-3 right-3 z-50">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-center text-white/70 hover:text-white bg-black/40 backdrop-blur-sm rounded-full w-9 h-9 transition-colors"
        aria-label="設定"
        aria-expanded={open}
      >
        <GearIcon />
      </button>

      {open && (
        <div className="absolute top-11 right-0 w-56 flex flex-col gap-3 bg-black/70 backdrop-blur-sm rounded-xl border border-white/15 p-3 shadow-xl">
          <SliderRow
            setting={{
              id: 'volume',
              label: '音量',
              value: volume,
              min: 0,
              max: 1,
              step: 0.05,
              onChange: onVolumeChange,
              format: (v) => `${Math.round(v * 100)}%`,
            }}
          />
          {extraSettings.map((s) => (
            <SliderRow key={s.id} setting={s} />
          ))}
        </div>
      )}
    </div>
  );
}
