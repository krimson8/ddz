'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Card } from './Card';
import type { Card as CardType, Play } from '@/types/game';
import { validatePlay } from '@/lib/cardUtils';

const TURN_SECONDS = 30;

interface CardHandProps {
  cards: CardType[];
  onPlay: (cards: CardType[]) => void;
  onPass: () => void;
  interactive?: boolean;
  playerIndex?: number;
  lastPlay?: Play | null;
  onSelectionChange?: (cards: CardType[]) => void;
}

export function CardHand({ cards, onPlay, onPass, interactive = true, playerIndex = 0, lastPlay, onSelectionChange }: CardHandProps) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onPassRef = useRef(onPass);
  onPassRef.current = onPass;

  // Notify parent of selection changes
  useEffect(() => {
    if (!onSelectionChange) return;
    const sel = Array.from(selected)
      .filter((i) => i < cards.length)
      .sort((a, b) => a - b)
      .map((i) => cards[i]);
    onSelectionChange(sel);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, cards]);

  // 20s countdown when it's my turn
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (!interactive) {
      setTimeLeft(null);
      return;
    }
    setTimeLeft(TURN_SECONDS);
    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev === null || prev <= 1) return 0;
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [interactive]);

  // Auto-pass when timer expires
  useEffect(() => {
    if (timeLeft !== 0 || !interactive) return;
    if (timerRef.current) clearInterval(timerRef.current);
    setSelected(new Set());
    setTimeLeft(null);
    onPassRef.current();
  }, [timeLeft, interactive]);

  // Clear selection when interactive starts (new turn)
  useEffect(() => {
    if (interactive) setSelected(new Set());
  }, [interactive]);

  function toggle(idx: number) {
    if (!interactive) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  function handlePlay() {
    if (!canPlay) return;
    const toPlay = Array.from(selected).sort((a, b) => a - b).map((i) => cards[i]);
    if (timerRef.current) clearInterval(timerRef.current);
    setSelected(new Set());
    setTimeLeft(null);
    onPlay(toPlay);
  }

  function handlePass() {
    if (timerRef.current) clearInterval(timerRef.current);
    setSelected(new Set());
    setTimeLeft(null);
    onPass();
  }

  const selectedCards = Array.from(selected)
    .filter((i) => i < cards.length)
    .sort((a, b) => a - b)
    .map((i) => cards[i]);
  const canPlay = selected.size > 0 && validatePlay(selectedCards, lastPlay ?? null) !== null;

  return (
    <div className="flex flex-col items-center gap-3 w-full">
      {/* Card strip */}
      <div className="flex flex-row items-end overflow-x-auto pb-2 px-2 gap-1 max-w-full">
        <AnimatePresence initial={false}>
          {cards.map((card, idx) => (
            <motion.div
              key={`${card.suit}-${card.rank}-${idx}`}
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ type: 'spring', stiffness: 300, damping: 25, delay: idx * 0.03 }}
            >
              <Card
                {...card}
                selected={selected.has(idx)}
                onClick={() => toggle(idx)}
                layoutId={`card-p${playerIndex}-${card.suit}-${card.rank}-${idx}`}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Action buttons + turn timer */}
      {interactive && (
        <div className="flex items-center gap-3">
          {timeLeft !== null && (
            <div
              className={`text-sm font-bold min-w-[32px] text-center tabular-nums ${
                timeLeft <= 5 ? 'text-red-400 animate-pulse' : 'text-white/70'
              }`}
            >
              {timeLeft}s
            </div>
          )}
          <button
            onClick={handlePlay}
            disabled={!canPlay}
            className="px-6 py-2 rounded-xl font-bold text-sm bg-yellow-400 hover:bg-yellow-300 disabled:opacity-40 disabled:cursor-not-allowed text-green-900 transition-colors min-h-[44px] min-w-[80px]"
          >
            出牌
          </button>
          <button
            onClick={handlePass}
            className="px-6 py-2 rounded-xl font-bold text-sm bg-white/20 hover:bg-white/30 text-white transition-colors min-h-[44px] min-w-[80px]"
          >
            不出
          </button>
        </div>
      )}
    </div>
  );
}
