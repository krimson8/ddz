'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useDragControls, useMotionValue } from 'framer-motion';

export interface EmojiHistoryEntry {
  key: number;
  nickname: string;
  emoji: string;
}

export interface ReactionGroup {
  label: string;
  items: string[];
}

interface EmojiChatBoxProps {
  /** Recent emojis (oldest → newest). Only the latest is shown; caller may cap length. */
  history: EmojiHistoryEntry[];
  groups: ReactionGroup[];
  selected: string;
  onSelect: (value: string) => void;
  onSend: () => void;
  /** Extra classes for positioning the panel (the caller decides where it floats). */
  className?: string;
  /**
   * localStorage key for remembering the dragged offset. Shared across games so
   * the box reappears where the user last left it. Set to null to disable.
   */
  storageKey?: string | null;
}

const DEFAULT_STORAGE_KEY = 'emoji_chatbox_offset';
const RESET_EVENT = 'emoji_chatbox_reset';
const BUBBLE_LIFETIME_MS = 3000;

/** Ask any mounted chatbox to recentre itself on screen (fired from the settings menu). */
export function resetEmojiChatBox(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(RESET_EVENT));
}

/** Read a persisted {x, y} drag offset, clamped so the box can't sit fully off-screen. */
function loadOffset(key: string): { x: number; y: number } {
  if (typeof window === 'undefined') return { x: 0, y: 0 };
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { x: 0, y: 0 };
    const parsed = JSON.parse(raw) as { x?: number; y?: number };
    const x = typeof parsed.x === 'number' ? parsed.x : 0;
    const y = typeof parsed.y === 'number' ? parsed.y : 0;
    // Keep at least a sliver on screen in every direction.
    const maxX = window.innerWidth - 48;
    const maxY = window.innerHeight - 48;
    return {
      x: Math.max(-maxX, Math.min(maxX, x)),
      y: Math.max(-maxY, Math.min(maxY, y)),
    };
  } catch {
    return { x: 0, y: 0 };
  }
}

interface Bubble {
  key: number;
  nickname: string;
  emoji: string;
}

/**
 * Compact 2-row emoji chatbox with floating reaction bubbles:
 *   Bubbles: pop above the box on each new emoji, overlapping in one spot.
 *   Row 1: drag grip · emoji picker · 送出
 *   Row 2: the single latest emoji message (cross-fades in place on change)
 *
 * Used by both DDZ and wuziqi so players and spectators share one widget.
 * Draggable by the grip only — the select/button stay fully clickable. The
 * dragged offset layers on top of the caller's anchor (className), is persisted
 * to localStorage, and can be recentred via resetEmojiChatBox().
 */
export function EmojiChatBox({
  history,
  groups,
  selected,
  onSelect,
  onSend,
  className = '',
  storageKey = DEFAULT_STORAGE_KEY,
}: EmojiChatBoxProps) {
  const dragControls = useDragControls();
  const rootRef = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  // Hydrate the saved offset once on mount (avoids SSR window access).
  useEffect(() => {
    if (!storageKey) return;
    const { x: sx, y: sy } = loadOffset(storageKey);
    x.set(sx);
    y.set(sy);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // Recentre on screen when asked (settings menu). Computes the delta from the
  // box's current rect so it works regardless of the caller's anchor.
  useEffect(() => {
    const handler = () => {
      const el = rootRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const currentCenterX = rect.left + rect.width / 2;
      const currentCenterY = rect.top + rect.height / 2;
      const targetCenterX = window.innerWidth / 2;
      const targetCenterY = window.innerHeight / 2;
      x.set(x.get() + (targetCenterX - currentCenterX));
      y.set(y.get() + (targetCenterY - currentCenterY));
      persist();
    };
    window.addEventListener(RESET_EVENT, handler);
    return () => window.removeEventListener(RESET_EVENT, handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persist = () => {
    if (!storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ x: x.get(), y: y.get() }));
    } catch {
      /* ignore */
    }
  };

  const latest = history.length > 0 ? history[history.length - 1] : null;

  // Flat list of every selectable emoji (across groups) so the wheel can step
  // through them in order regardless of which optgroup they live in.
  const flatItems = groups.flatMap((group) => group.items);

  // Wheel over the picker cycles to the prev/next emoji without opening the
  // dropdown. Down/right = next, up/left = previous; clamped at the ends.
  const handleWheel = (e: React.WheelEvent<HTMLSelectElement>) => {
    if (flatItems.length === 0) return;
    e.preventDefault();
    const idx = flatItems.indexOf(selected);
    const dir = e.deltaY > 0 ? 1 : -1;
    // If the current value isn't in the list, start from the appropriate end.
    const base = idx === -1 ? (dir > 0 ? -1 : flatItems.length) : idx;
    const next = Math.max(0, Math.min(flatItems.length - 1, base + dir));
    if (flatItems[next] !== selected) onSelect(flatItems[next]);
  };

  // Floating bubbles — each new history entry pops a bubble above the box that
  // overlaps any still-fading ones, then auto-expires.
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const lastSeenKeyRef = useRef<number | null>(null);
  useEffect(() => {
    if (!latest) return;
    if (lastSeenKeyRef.current === latest.key) return; // already shown
    lastSeenKeyRef.current = latest.key;
    const bubble: Bubble = { key: latest.key, nickname: latest.nickname, emoji: latest.emoji };
    setBubbles((prev) => [...prev, bubble]);
    // Each bubble owns its own expiry timer. We deliberately don't clear it on
    // cleanup: when a new `latest` arrives the effect re-runs, and clearing here
    // would cancel the *previous* bubble's removal so it would linger forever.
    setTimeout(() => {
      setBubbles((prev) => prev.filter((b) => b.key !== bubble.key));
    }, BUBBLE_LIFETIME_MS);
  }, [latest]);

  return (
    <motion.div
      ref={rootRef}
      drag
      dragControls={dragControls}
      dragListener={false}
      dragMomentum={false}
      dragElastic={0}
      onDragEnd={persist}
      style={{ x, y }}
      className={[
        // NOTE: no `position` class here — the caller's `className` owns positioning
        // (e.g. `fixed`). Forcing `relative` would override `fixed` and drop the box
        // back into normal flow. The bubble anchor below establishes its own context.
        'flex flex-col gap-1 rounded-xl border border-white/15 bg-black/30 backdrop-blur-sm px-2 py-1.5 w-56 sm:w-64',
        className,
      ].join(' ')}
    >
      {/* Floating bubbles — anchored above the box, overlapping in one spot */}
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 pointer-events-none" style={{ width: 0, height: 0 }}>
        <AnimatePresence>
          {bubbles.map((b) => (
            <motion.div
              key={b.key}
              // x: '-50%' centers the bubble on the anchor. It lives inside the
              // motion transform on purpose — a Tailwind -translate-x-1/2 here would
              // be overwritten by the transform framer-motion writes for y/scale.
              initial={{ opacity: 0, x: '-50%', y: 12, scale: 0.85 }}
              animate={{ opacity: 1, x: '-50%', y: 0, scale: 1 }}
              exit={{ opacity: 0, x: '-50%', y: -20, scale: 0.9 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              className="absolute bottom-0 left-0 whitespace-nowrap bg-black/80 border border-yellow-400/60 text-white text-2xl font-bold px-4 py-2 rounded-xl shadow-xl"
              style={{ zIndex: b.key }}
            >
              <span className="text-white/60 text-sm mr-2 align-middle">{b.nickname}</span>
              {b.emoji}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Row 1: drag grip · picker · send (single line) */}
      <div className="flex items-center gap-1.5">
        <div
          onPointerDown={(e) => dragControls.start(e)}
          className="flex-shrink-0 px-1 self-stretch flex items-center cursor-grab active:cursor-grabbing touch-none text-white/40 hover:text-white/70 select-none"
          title="拖曳移動"
        >
          <span className="text-xs tracking-[0.15em] leading-none">⋮⋮</span>
        </div>
        <select
          value={selected}
          onChange={(e) => onSelect(e.target.value)}
          onWheel={handleWheel}
          className="flex-1 min-w-0 bg-black/50 text-white text-sm rounded-lg px-1.5 py-1.5 border border-white/20 cursor-pointer focus:outline-none"
        >
          {groups.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.items.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <button
          onClick={onSend}
          className="flex-shrink-0 px-2.5 py-1.5 rounded-lg bg-yellow-400 hover:bg-yellow-300 active:scale-90 transition-all text-green-900 font-bold text-sm"
        >
          送出
        </button>
      </div>

      {/* Row 2: single latest message — cross-fades in place, no stacking */}
      <div className="relative h-5 px-1">
        <AnimatePresence mode="wait" initial={false}>
          {latest ? (
            <motion.div
              key={latest.key}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="absolute inset-0 flex items-baseline gap-1.5 text-white/90 leading-tight"
            >
              <span className="text-white/50 text-[11px] max-w-[90px] truncate flex-shrink-0">
                {latest.nickname}
              </span>
              <span className="text-sm font-bold truncate">{latest.emoji}</span>
            </motion.div>
          ) : (
            <motion.span
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="absolute inset-0 flex items-center text-white/30 text-[11px] italic"
            >
              還沒有人發言…
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
