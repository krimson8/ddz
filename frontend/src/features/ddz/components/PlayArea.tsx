'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Card } from './Card';
import { handLayoutId } from './cardLayout';
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

/** Which seat the play came from, so the cards arrive from the right direction. */
export type PlayOrigin = 'self' | 'left' | 'right' | null;

interface PlayAreaProps {
  lastPlay: Play | null;
  playerName?: string;
  origin?: PlayOrigin;
}

/** Off-screen start offset for a play that did not come from the local hand. */
function entryOffset(origin: PlayOrigin): { x: number; y: number; rotate: number } {
  switch (origin) {
    case 'left':
      return { x: -220, y: -150, rotate: -18 };
    case 'right':
      return { x: 220, y: -150, rotate: 18 };
    default:
      return { x: 0, y: 40, rotate: 0 };
  }
}

export function PlayArea({ lastPlay, playerName, origin = null }: PlayAreaProps) {
  // User-adjustable size of the centre played cards (set from the settings menu).
  const [cardScale, setCardScale] = useState(1);
  useEffect(() => {
    setCardScale(loadCardScale());
    return onCardScaleChange(setCardScale);
  }, []);

  const isBomb = lastPlay?.type === 'bomb';
  const isRocket = lastPlay?.type === 'rocket';
  const isBig = isBomb || isRocket;

  // Own plays fly in via the shared layoutId, so they must not also be offset by
  // the wrapper — that would double up the motion.
  const from = entryOffset(origin === 'self' ? null : origin);

  return (
    <div className="ddz-scene flex flex-col items-center gap-2 justify-center w-full">
      {/* Last played cards */}
      <AnimatePresence mode="wait">
        {lastPlay ? (
          <motion.div
            key={`${lastPlay.type}-${lastPlay.rank}`}
            initial={{ opacity: 0, scale: 0.7, ...from }}
            animate={{ opacity: 1, scale: 1, x: 0, y: 0, rotate: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: -24, transition: { duration: 0.18 } }}
            transition={{ type: 'spring', stiffness: 260, damping: 24 }}
            className="flex flex-col items-center gap-2"
          >
            {playerName && (
              <span className="text-white/70 text-sm font-medium bg-black/30 px-3 py-1 rounded-full backdrop-blur-sm">
                {playerName}
              </span>
            )}

            {/* Hand-type banner — bombs and rockets get the loud treatment */}
            <motion.span
              initial={isBig ? { scale: 0.4, opacity: 0 } : false}
              animate={isBig ? { scale: 1, opacity: 1 } : {}}
              transition={{ type: 'spring', stiffness: 420, damping: 14 }}
              className={
                isBig
                  ? 'text-transparent bg-clip-text bg-gradient-to-b from-yellow-200 via-orange-300 to-red-500 text-2xl sm:text-3xl font-black tracking-widest drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)]'
                  : 'text-yellow-300 text-base sm:text-lg font-bold'
              }
            >
              {HAND_TYPE_LABELS[lastPlay.type] ?? lastPlay.type}
              {isRocket ? ' 🚀' : isBomb ? ' 💣' : ''}
            </motion.span>

            <div
              className="preserve-3d flex gap-1.5 flex-wrap justify-center max-w-full"
              style={{
                transform: `scale(${cardScale}) rotateX(14deg)`,
                transformOrigin: 'center top',
              }}
            >
              {lastPlay.cards.map((card, i) => (
                <motion.div
                  key={`${card.suit}-${card.rank}`}
                  initial={{ y: -18, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  // Cards settle one after another rather than all at once.
                  transition={{ delay: i * 0.045, type: 'spring', stiffness: 400, damping: 26 }}
                >
                  <Card
                    {...card}
                    large
                    layoutId={handLayoutId(card)}
                    className={isBig ? 'ddz-sheen overflow-hidden' : ''}
                  />
                </motion.div>
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
