'use client';

/**
 * Shared store for the DDZ centre played-card scale. The setting is changed in
 * the top-right settings menu but consumed deep in PlayArea, so we coordinate
 * via localStorage + a custom event rather than prop-drilling through GameBoard.
 */

const STORAGE_KEY = 'ddz_card_scale';
const EVENT_NAME = 'ddz_card_scale_change';

export const CARD_SCALE_MIN = 0.6;
export const CARD_SCALE_MAX = 1.6;
export const CARD_SCALE_DEFAULT = 1;

export function clampCardScale(v: number): number {
  if (Number.isNaN(v)) return CARD_SCALE_DEFAULT;
  return Math.max(CARD_SCALE_MIN, Math.min(CARD_SCALE_MAX, v));
}

export function loadCardScale(): number {
  if (typeof window === 'undefined') return CARD_SCALE_DEFAULT;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return CARD_SCALE_DEFAULT;
    return clampCardScale(parseFloat(raw));
  } catch {
    return CARD_SCALE_DEFAULT;
  }
}

/** Persist + broadcast so any mounted PlayArea updates live. */
export function setCardScale(v: number): void {
  const clamped = clampCardScale(v);
  try {
    localStorage.setItem(STORAGE_KEY, String(clamped));
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: clamped }));
  }
}

/** Subscribe to scale changes. Returns an unsubscribe fn. */
export function onCardScaleChange(cb: (v: number) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (e: Event) => cb((e as CustomEvent<number>).detail);
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
