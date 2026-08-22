'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Card } from './Card';
import { handLayoutId } from './cardLayout';
import { sfx } from '@/features/ddz/sfx';
import { recordHandRects, type FlightRect } from '@/features/ddz/cardFlight';
import type { Card as CardType, Play } from '@/features/ddz/types';
import { validatePlay } from '@/features/ddz/cardUtils';

interface CardHandProps {
  cards: CardType[];
  onPlay: (cards: CardType[]) => void;
  onPass: () => void;
  interactive?: boolean;
  lastPlay?: Play | null;
  onSelectionChange?: (cards: CardType[]) => void;
  /** Epoch ms when the current turn expires (from server). Only relevant when interactive. */
  turnEndTime?: number | null;
  /** Whether to render the 出牌/不出 action row (hidden for spectator hands). */
  showActions?: boolean;
}

/**
 * Fan geometry. The arc is kept deliberately shallow: a played card is measured
 * out of this row and flown to the table (see cardFlight.ts), and a steep angle
 * would make the card it launches from read as a different size than the one
 * that takes off.
 */
const MAX_ARC_DEG = 18;      // total spread, first card to last
const ARC_ORIGIN_PX = 230;   // pivot distance below the cards

/**
 * Gap between cards. Cards never overlap: an overlapped fan makes the card next
 * to a selected one awkward to hit, because the selected card lifts and widens
 * its own hit area over its neighbour's exposed strip. A full-width card each
 * is worth the horizontal scrolling.
 */
const CARD_GAP = 6;

function fanAngle(i: number, n: number): number {
  if (n < 2) return 0;
  const arc = Math.min(MAX_ARC_DEG, n * 1.4);
  return -arc / 2 + (i / (n - 1)) * arc;
}

/** Cards near the middle of the fan sit a touch higher, as they would in a hand. */
function fanLift(i: number, n: number): number {
  if (n < 3) return 0;
  const p = (i / (n - 1)) * 2 - 1; // -1 … 1
  return (1 - p * p) * -4;
}

/**
 * Horizontal room the fan needs beyond its layout box.
 *
 * Each card is rotated about a pivot well below the row, so the end cards are
 * displaced sideways by roughly pivot·sin(halfArc) — about 36px at a full
 * 17-card hand. Layout knows nothing about that, so without matching padding
 * the scroll container simply crops the first and last card.
 */
function fanPadding(count: number): number {
  if (count < 2) return 12;
  const halfArc = (Math.min(MAX_ARC_DEG, count * 1.4) / 2) * (Math.PI / 180);
  return Math.ceil(ARC_ORIGIN_PX * Math.sin(halfArc) + 14);
}

export function CardHand({ cards, onPlay, onPass, interactive = true, lastPlay, onSelectionChange, turnEndTime, showActions = true }: CardHandProps) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Live element per card, so a play can be measured on its way out.
  const cardEls = useRef(new Map<string, HTMLDivElement>());
  const fanPad = fanPadding(cards.length);

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
      if (next.has(idx)) {
        next.delete(idx);
        sfx.play('deselect', { vary: 0.1 });
      } else {
        next.add(idx);
        // Pitch rises slightly with each extra card held, so building a big
        // hand type has an audible shape to it.
        sfx.play('select', { rate: 1 + Math.min(next.size, 8) * 0.03, vary: 0.05 });
      }
      return next;
    });
  }

  function handlePlay() {
    if (!canPlay) return;
    const toPlay = Array.from(selected).sort((a, b) => a - b).map((i) => cards[i]);

    // Snapshot where these cards are sitting right now. Once the server echoes
    // the play they are gone from the hand, and the play area needs somewhere
    // to fly them from. Measured by centre and layout size rather than by the
    // bounding rect, because each card sits inside a fan rotation and the rect
    // is the rotated card's larger axis-aligned box.
    const rects = new Map<string, FlightRect>();
    for (const idx of Array.from(selected).sort((a, b) => a - b)) {
      const card = cards[idx];
      const el = cardEls.current.get(handLayoutId(card));
      if (!el) continue;
      // The card itself, not the fan wrapper around it: a selected card is
      // lifted 18px by its own transform, and launching from the wrapper would
      // drop it back down before it set off.
      const inner = (el.firstElementChild as HTMLElement | null) ?? el;
      const r = inner.getBoundingClientRect();
      rects.set(handLayoutId(card), {
        cx: r.left + r.width / 2,
        cy: r.top + r.height / 2,
        w: inner.offsetWidth,
        h: inner.offsetHeight,
        rot: fanAngle(idx, cards.length),
      });
    }
    if (rects.size) recordHandRects(rects);

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
      {/* Card strip. pt-9 leaves headroom for the lift on a selected card, which
          the horizontal scroller would otherwise clip.

          The inner row is centred with `m-auto` rather than the outer using
          `justify-center`: a centred flex row that overflows its scroll
          container clips its own leading edge, and the clipped part cannot be
          scrolled back into view — the first cards end up permanently
          unreachable. Auto margins collapse to zero instead of going negative,
          so the row centres when it fits and left-aligns when it does not. */}
      <div
        ref={scrollRef}
        className="flex overflow-x-auto no-scrollbar pt-9 pb-3 max-w-full"
        onWheel={(e) => {
          if (e.deltaY === 0 || !scrollRef.current) return;
          e.preventDefault();
          scrollRef.current.scrollLeft += e.deltaY;
        }}
      >
        <div
          className="flex flex-row items-end m-auto"
          style={{ gap: CARD_GAP, paddingLeft: fanPad, paddingRight: fanPad }}
        >
        <AnimatePresence initial={false} mode="popLayout">
          {cards.map((card, idx) => (
            <motion.div
              key={`${card.suit}-${card.rank}`}
              // Position-only layout keeps the projection maths simple next to
              // the rotated inner wrapper.
              layout="position"
              initial={{ opacity: 0, y: 60, rotateZ: -14 }}
              animate={{ opacity: 1, y: 0, rotateZ: 0 }}
              exit={{ opacity: 0, scale: 0.85, transition: { duration: 0.12 } }}
              transition={{ type: 'spring', stiffness: 350, damping: 30 }}
              style={{ zIndex: selected.has(idx) ? 100 + idx : idx }}
            >
              <div
                ref={(el) => {
                  const id = handLayoutId(card);
                  if (el) cardEls.current.set(id, el);
                  else cardEls.current.delete(id);
                }}
                style={{
                  transform: `rotate(${fanAngle(idx, cards.length)}deg) translateY(${fanLift(idx, cards.length)}px)`,
                  transformOrigin: `50% ${ARC_ORIGIN_PX}px`,
                }}
              >
                <Card
                  {...card}
                  selected={selected.has(idx)}
                  onClick={() => toggle(idx)}
                />
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        </div>
      </div>

      {/* Action buttons + turn timer — always rendered; disabled when it isn't your turn */}
      {showActions && (
      <div className="flex items-center gap-3">
        <div
          className={`text-sm font-bold min-w-[32px] text-center tabular-nums ${
            timeLeft !== null && timeLeft <= 5 ? 'text-red-400 animate-pulse' : 'text-white/70'
          }`}
        >
          {timeLeft !== null ? `${timeLeft}s` : ''}
        </div>
        <motion.button
          onClick={handlePlay}
          disabled={!interactive || !canPlay}
          whileTap={interactive && canPlay ? { scale: 0.94 } : undefined}
          animate={
            interactive && canPlay
              ? { boxShadow: ['0 0 0 0 rgba(250,204,21,0)', '0 0 16px 3px rgba(250,204,21,0.6)', '0 0 0 0 rgba(250,204,21,0)'] }
              : { boxShadow: '0 0 0 0 rgba(250,204,21,0)' }
          }
          transition={interactive && canPlay ? { duration: 1.4, repeat: Infinity, ease: 'easeInOut' } : {}}
          className="px-6 py-2 rounded-xl font-bold text-sm bg-yellow-400 hover:bg-yellow-300 disabled:opacity-40 disabled:cursor-not-allowed text-green-900 transition-colors min-h-[44px] min-w-[80px]"
        >
          出牌
        </motion.button>
        <motion.button
          onClick={handlePass}
          disabled={!interactive}
          whileTap={interactive ? { scale: 0.94 } : undefined}
          className="px-6 py-2 rounded-xl font-bold text-sm bg-white/20 hover:bg-white/30 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors min-h-[44px] min-w-[80px]"
        >
          不出
        </motion.button>
      </div>
      )}
    </div>
  );
}
