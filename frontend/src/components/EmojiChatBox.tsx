'use client';

import { useEffect } from 'react';
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

/**
 * Compact 2-row emoji chatbox:
 *   Row 1: drag grip · emoji picker · 送出
 *   Row 2: the single latest emoji message (cross-fades in place on change)
 *
 * Used by both DDZ and wuziqi so players and spectators share one widget.
 * Draggable by the grip only — the select/button stay fully clickable. The
 * dragged offset layers on top of the caller's anchor (className) and is
 * persisted to localStorage so it survives reloads and game switches.
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

  const persist = () => {
    if (!storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ x: x.get(), y: y.get() }));
    } catch {
      /* ignore */
    }
  };

  const latest = history.length > 0 ? history[history.length - 1] : null;

  return (
    <motion.div
      drag
      dragControls={dragControls}
      dragListener={false}
      dragMomentum={false}
      dragElastic={0}
      onDragEnd={persist}
      style={{ x, y }}
      className={[
        'flex flex-col gap-1 rounded-xl border border-white/15 bg-black/30 backdrop-blur-sm px-2 py-1.5 w-56 sm:w-64',
        className,
      ].join(' ')}
    >
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
