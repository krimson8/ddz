'use client';

import { AnimatePresence, motion } from 'framer-motion';

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
}

/**
 * 30%-opaque emoji chatbox: shows the recent emoji history (nickname + emoji)
 * and houses the emoji picker + send button. Used by both DDZ and wuziqi so
 * players and spectators share one widget.
 */
export function EmojiChatBox({
  history,
  groups,
  selected,
  onSelect,
  onSend,
  className = '',
}: EmojiChatBoxProps) {
  return (
    <div
      className={[
        'flex flex-col gap-1.5 rounded-xl border border-white/15 bg-black/30 backdrop-blur-sm p-2 w-44 sm:w-52',
        className,
      ].join(' ')}
    >
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
    </div>
  );
}
