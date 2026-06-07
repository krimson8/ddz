'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Page-level volume state for the settings menu. Hydrates from localStorage,
 * persists on change, and forwards the value to the sound-effects setter.
 * `storageKey` must match the key the game's sound hook reads/writes so they
 * stay in sync (DDZ: `ddz_volume`, wuziqi: `wuziqi_volume`).
 */
export function useVolume(applyVolume: (v: number) => void, storageKey: string) {
  const [volume, setVolumeState] = useState(1);

  useEffect(() => {
    try {
      const saved = parseFloat(localStorage.getItem(storageKey) ?? '1');
      if (!isNaN(saved)) {
        const clamped = Math.max(0, Math.min(1, saved));
        setVolumeState(clamped);
        applyVolume(clamped);
      }
    } catch {
      /* ignore */
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const setVolume = useCallback(
    (v: number) => {
      const clamped = Math.max(0, Math.min(1, v));
      setVolumeState(clamped);
      applyVolume(clamped); // sound hook also writes localStorage
    },
    [applyVolume],
  );

  return { volume, setVolume };
}
