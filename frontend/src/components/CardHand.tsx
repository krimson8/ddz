'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Card } from './Card';
import type { Card as CardType, Play } from '@/types/game';
import { validatePlay } from '@/lib/cardUtils';

interface CardHandProps {
  cards: CardType[];
  onPlay: (cards: CardType[]) => void;
  onPass: () => void;
  interactive?: boolean;
  playerIndex?: number;
  lastPlay?: Play | null;
  onSelectionChange?: (cards: CardType[]) => void;
  /** Epoch ms when the current turn expires (from server). Only relevant when interactive. */
  turnEndTime?: number | null;
}

export function CardHand({ cards, onPlay, onPass, interactive = true, playerIndex = 0, lastPlay, onSelectionChange, turnEndTime }: CardHandProps) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

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

  // Countdown derived from server-sent turnEndTime — no local auto-pass logic
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (!interactive || !turnEndTime) {
      setTimeLeft(null);
      return;
    }
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((turnEndTime - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (remaining <= 0 && timerRef.current) clearInterval(timerRef.current);
    };
    tick();
    timerRef.current = setInterval(tick, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [interactive, turnEndTime]);

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
      <div
        ref={scrollRef}
        className="flex flex-row items-end justify-center overflow-x-auto pb-2 px-2 gap-1 max-w-full"
        onWheel={(e) => {
          if (e.deltaY === 0 || !scrollRef.current) return;
          e.preventDefault();
          scrollRef.current.scrollLeft += e.deltaY;
        }}
      >
        <AnimatePresence initial={false} mode="popLayout">
          {cards.map((card, idx) => (
            <motion.div
              key={`${card.suit}-${card.rank}`}
              layout
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ type: 'spring', stiffness: 350, damping: 30 }}
            >
              <Card
                {...card}
                selected={selected.has(idx)}
                onClick={() => toggle(idx)}
                layoutId={`card-p${playerIndex}-${card.suit}-${card.rank}`}
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
