'use client';

import { useEffect, useState } from 'react';

interface VolumeControlProps {
  onVolumeChange: (v: number) => void;
}

function VolumeIcon({ volume }: { volume: number }) {
  if (volume === 0) return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <line x1="23" y1="9" x2="17" y2="15" />
      <line x1="17" y1="9" x2="23" y2="15" />
    </svg>
  );
  if (volume < 0.5) return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  );
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  );
}

export function VolumeControl({ onVolumeChange }: VolumeControlProps) {
  const [volume, setVolume] = useState(1);
  const [open, setOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    try {
      const saved = parseFloat(localStorage.getItem('ddz_volume') ?? '1');
      if (!isNaN(saved)) setVolume(Math.max(0, Math.min(1, saved)));
    } catch { /* ignore */ }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setVolume(v);
    onVolumeChange(v);
  };

  const toggleMute = () => {
    const next = volume === 0 ? 1 : 0;
    setVolume(next);
    onVolumeChange(next);
  };

  const handleClear = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      // Auto-cancel confirmation after 3 seconds
      setTimeout(() => setConfirmClear(false), 3000);
      return;
    }
    // Clear all ddz_ keys except nickname and volume
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('ddz_') && key !== 'ddz_nickname' && key !== 'ddz_volume') {
        toRemove.push(key);
      }
    }
    toRemove.forEach((k) => localStorage.removeItem(k));
    setConfirmClear(false);
    window.location.reload();
  };

  return (
    <div className="fixed top-3 left-3 z-50 flex items-center gap-2">
      <button
        onClick={toggleMute}
        className="w-9 h-9 flex items-center justify-center rounded-full bg-black/50 hover:bg-black/70 text-white transition-colors backdrop-blur-sm"
        aria-label={volume === 0 ? '取消靜音' : '靜音'}
      >
        <VolumeIcon volume={volume} />
      </button>

      <div
        className={`flex items-center transition-all duration-200 overflow-hidden ${open ? 'w-28 opacity-100' : 'w-0 opacity-0'}`}
      >
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={handleChange}
          className="w-full accent-yellow-400 cursor-pointer"
          aria-label="音量"
        />
      </div>

      <button
        onClick={() => setOpen((o) => !o)}
        className="w-6 h-6 flex items-center justify-center rounded-full bg-black/40 hover:bg-black/60 text-white/70 hover:text-white text-xs transition-colors backdrop-blur-sm"
        aria-label="展開音量"
      >
        {open ? '‹' : '›'}
      </button>

      <button
        onClick={handleClear}
        className={`h-6 px-2 flex items-center justify-center rounded-full text-xs font-bold transition-colors backdrop-blur-sm ${
          confirmClear
            ? 'bg-red-500 hover:bg-red-400 text-white'
            : 'bg-black/40 hover:bg-black/60 text-white/50 hover:text-white'
        }`}
        aria-label="重置房間連線"
        title={confirmClear ? '再按一次確認清除' : '點兩下清除房間連線（保留暱稱）'}
      >
        {confirmClear ? '確定？' : '⟳'}
      </button>
    </div>
  );
}
