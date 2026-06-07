'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Card } from './Card';
import { loadCardScale, onCardScaleChange } from '@/features/ddz/cardScale';
import type { Play } from '@/features/ddz/types';

const HAND_TYPE_LABELS: Record<string, string> = {
  single: '單張',
  pair: '對子',
  trio: '三張',
  trio_single: '三帶一',
  trio_pair: '三帶對',
  sequence: '順子',
  pair_sequence: '連對',
  trio_sequence: '飛機',
  trio_seq_singles: '飛機帶單',
  trio_seq_pairs: '飛機帶對',
  quad_singles: '四帶二單',
  quad_pairs: '四帶二對',
  bomb: '炸彈',
  rocket: '火箭',
};

interface PlayAreaProps {
  lastPlay: Play | null;
  playerName?: string;
}

export function PlayArea({ lastPlay, playerName }: PlayAreaProps) {
  // User-adjustable size of the centre played cards (set from the settings menu).
  const [cardScale, setCardScale] = useState(1);
  useEffect(() => {
    setCardScale(loadCardScale());
    return onCardScaleChange(setCardScale);
  }, []);

  return (
    <div className="flex flex-col items-center gap-2 justify-center">
      {/* Last played cards */}
      <AnimatePresence mode="wait">
        {lastPlay ? (
          <motion.div
            key={`${lastPlay.type}-${lastPlay.rank}`}
            initial={{ opacity: 0, scale: 0.85, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.85, y: -10 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="flex flex-col items-center gap-2"
          >
            {playerName && (
              <span className="text-white/70 text-sm font-medium bg-black/30 px-3 py-1 rounded-full">
                {playerName}
              </span>
            )}
            <span className="text-yellow-300 text-base sm:text-lg font-bold">
              {HAND_TYPE_LABELS[lastPlay.type] ?? lastPlay.type}
            </span>
            <div
              className="flex gap-1.5 flex-wrap justify-center max-w-full transition-transform"
              style={{ transform: `scale(${cardScale})`, transformOrigin: 'center top' }}
            >
              {lastPlay.cards.map((card, i) => (
                <Card key={i} {...card} large layoutId={`played-${card.suit}-${card.rank}-${i}`} />
              ))}
            </div>
          </motion.div>
        ) : (
          <motion.p
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.5 }}
            exit={{ opacity: 0 }}
            className="text-white/50 text-sm"
          >
            等待出牌…
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
