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
  /** Last few emojis sent by everyone (oldest → newest). Caller caps the length. */
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
 * 30%-opaque emoji chatbox: shows the recent emoji history (nickname + emoji)
 * and houses the emoji picker + send button. Used by both DDZ and wuziqi so
 * players and spectators share one widget.
 *
 * Draggable by the top grip bar only — the select/button stay fully clickable.
 * The dragged offset is layered on top of the caller's anchor (className) and
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
        'flex flex-col gap-1.5 rounded-xl border border-white/15 bg-black/30 backdrop-blur-sm p-2 w-44 sm:w-52',
        className,
      ].join(' ')}
    >
      {/* Drag handle — only this initiates a drag, so the controls below stay reliable */}
      <div
        onPointerDown={(e) => dragControls.start(e)}
        className="flex items-center justify-center -mt-1 -mx-1 mb-0.5 py-1 cursor-grab active:cursor-grabbing touch-none text-white/40 hover:text-white/70 select-none"
        title="拖曳移動"
      >
        <span className="text-xs tracking-[0.3em] leading-none">⋯⋯</span>
      </div>

      {/* History — last few, no scroll */}
      <div className="flex flex-col gap-0.5 min-h-[60px] justify-end">
        {history.length === 0 ? (
          <span className="text-white/30 text-[11px] italic text-center py-2">
            還沒有人發言…
          </span>
        ) : (
          <AnimatePresence initial={false}>
            {history.map((entry) => (
              <motion.div
                key={entry.key}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="flex items-baseline gap-1.5 text-white/90 leading-tight"
              >
                <span className="text-white/50 text-[11px] max-w-[80px] truncate flex-shrink-0">
                  {entry.nickname}
                </span>
                <span className="text-sm font-bold truncate">{entry.emoji}</span>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>

      {/* Send controls */}
      <div className="flex items-center gap-1.5">
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
    </motion.div>
  );
}
