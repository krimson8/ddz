'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Card, NORMAL_CARD_WIDTH } from './Card';
import { handLayoutId } from './cardLayout';
import { sfx } from '@/features/ddz/sfx';
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
 * Fan geometry. The arc is kept deliberately shallow: the cards carry a
 * layoutId that framer-motion uses to fly them into the play area, and layout
 * projection measures axis-aligned bounding boxes, so a steep rotation would
 * make the departing card visibly jump in size as it leaves the hand.
 */
const MAX_ARC_DEG = 18;      // total spread, first card to last
const ARC_ORIGIN_PX = 230;   // pivot distance below the cards

/**
 * Narrowest strip of a card we will ever leave exposed, in px. Overlapping any
 * tighter than this makes individual cards genuinely hard to hit — 44px is the
 * usual minimum comfortable touch target, and the extra couple of px absorbs
 * the horizontal skew the fan rotation adds.
 */
const MIN_STEP = 46;
/** Breathing room between cards once the hand is small enough to fit outright. */
const CARD_GAP = 4;
/** Horizontal padding on the strip (px-3 on each side). */
const STRIP_PADDING = 24;

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
 * Decide how far apart to space the cards.
 *
 * A fixed overlap cannot work across screen sizes: the value that fits 17 cards
 * on a phone squashes them into an untappable ribbon, and the value that reads
 * well on a desktop overflows a phone entirely. So we spread the hand as widely
 * as the strip allows and only start overlapping when it genuinely runs out of
 * room — never past MIN_STEP, at which point the strip scrolls instead.
 */
function useFanSpacing(count: number, ref: RefObject<HTMLDivElement | null>) {
  const [metrics, setMetrics] = useState<{ width: number; cardW: number }>({
    width: 0,
    cardW: NORMAL_CARD_WIDTH.base,
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // ResizeObserver fires once when observation starts, and that initial call
    // is what seeds the measurement — hence no synchronous read in the body.
    const ro = new ResizeObserver(() => {
      setMetrics({
        width: el.clientWidth,
        cardW: window.innerWidth >= 640 ? NORMAL_CARD_WIDTH.sm : NORMAL_CARD_WIDTH.base,
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

  const { width, cardW } = metrics;
  const avail = Math.max(0, width - STRIP_PADDING);
  const maxStep = cardW + CARD_GAP;

  // The cards at each end of the fan are rotated, so their painted box is wider
  // than their layout box and they hang over the ends of the row. That overhang
  // is real scroll width, and leaving it out of the sums makes a hand that was
  // calculated to fit actually overflow — and then a centred row clips its own
  // leading edge, putting the first cards out of reach.
  const halfArc = (Math.min(MAX_ARC_DEG, count * 1.4) / 2) * (Math.PI / 180);
  const cardH = cardW * (104 / 72); // normal cards are 60×87 / 72×104
  const overhang = Math.max(0, cardW * Math.cos(halfArc) + cardH * Math.sin(halfArc) - cardW);

  const idealStep = count > 1 ? (avail - cardW - overhang) / (count - 1) : maxStep;
  const step = Math.max(MIN_STEP, Math.min(maxStep, idealStep));
  // Floor rather than round so accumulated rounding can only ever shrink the
  // fan, never nudge a hand that just fits into overflowing.
  //
  // Before the first measurement arrives `width` is 0, which lands on MIN_STEP.
  // That is the deliberate fallback: it is always tappable, and centring is
  // handled in CSS, so nothing breaks if the observer never fires at all.
  return Math.floor(step - cardW);
}

export function CardHand({ cards, onPlay, onPass, interactive = true, lastPlay, onSelectionChange, turnEndTime, showActions = true }: CardHandProps) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const margin = useFanSpacing(cards.length, scrollRef);

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
        className="flex overflow-x-auto no-scrollbar pt-9 pb-2 px-3 max-w-full"
        onWheel={(e) => {
          if (e.deltaY === 0 || !scrollRef.current) return;
          e.preventDefault();
          scrollRef.current.scrollLeft += e.deltaY;
        }}
      >
        <div className="flex flex-row items-end m-auto">
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
              style={{ marginLeft: idx === 0 ? 0 : margin, zIndex: selected.has(idx) ? 100 + idx : idx }}
            >
              <div
                style={{
                  transform: `rotate(${fanAngle(idx, cards.length)}deg) translateY(${fanLift(idx, cards.length)}px)`,
                  transformOrigin: `50% ${ARC_ORIGIN_PX}px`,
                }}
              >
                <Card
                  {...card}
                  selected={selected.has(idx)}
                  onClick={() => toggle(idx)}
                  layoutId={handLayoutId(card)}
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
