'use client';

import { useEffect, useState } from 'react';

interface VolumeControlProps {
  onVolumeChange: (v: number) => void;
}

function VolumeIcon({ volume }: { volume: number }) {
  if (volume === 0) return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <line x1="23" y1="9" x2="17" y2="15" />
      <line x1="17" y1="9" x2="23" y2="15" />
    </svg>
  );
  if (volume < 0.5) return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  );
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  );
}

export function VolumeControl({ onVolumeChange }: VolumeControlProps) {
  const [volume, setVolume] = useState(1);
  const [openMobile, setOpenMobile] = useState(false);

  useEffect(() => {
    try {
      const saved = parseFloat(localStorage.getItem('wuziqi_volume') ?? '1');
      if (!isNaN(saved)) setVolume(Math.max(0, Math.min(1, saved)));
    } catch { /* ignore */ }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setVolume(v);
    onVolumeChange(v);
  };

  return (
    <div className="fixed top-3 right-3 z-50 flex items-center gap-2 bg-black/40 backdrop-blur-sm rounded-full px-3 py-1.5">
      <button
        type="button"
        onClick={() => setOpenMobile((o) => !o)}
        className="text-white/70 flex-shrink-0 sm:cursor-default sm:pointer-events-none"
        aria-label={openMobile ? '收起音量' : '展開音量'}
      >
        <VolumeIcon volume={volume} />
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={volume}
        onChange={handleChange}
        className={[
          'accent-yellow-400 cursor-pointer transition-all duration-200',
          // Mobile: collapsible — width/opacity controlled by openMobile.
          // sm+: always visible at full width.
          openMobile ? 'w-24 opacity-100' : 'w-0 opacity-0',
          'sm:w-24 sm:opacity-100',
        ].join(' ')}
        aria-label="音量"
      />
    </div>
  );
}
