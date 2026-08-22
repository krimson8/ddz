'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Card } from './Card';
import { CardFlight, type FlightItem } from './CardFlight';
import { handLayoutId } from './cardLayout';
import { loadCardScale, onCardScaleChange } from '@/features/ddz/cardScale';
import {
  FLIGHT_MS,
  FLIGHT_STAGGER_MS,
  takeHandRects,
  type FlightRect,
} from '@/features/ddz/cardFlight';
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

/** Degrees of X-tilt the played stack lies at, matching the table perspective. */
const TABLE_TILT = 14;

/** useLayoutEffect warns when it runs during SSR; this component is prerendered. */
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

interface PlayAreaProps {
  lastPlay: Play | null;
  playerName?: string;
  origin?: PlayOrigin;
}

/**
 * Where a card starts when we did not watch it leave a hand.
 *
 * An opponent's cards are only ever drawn as a face-down count, so there is no
 * card element to measure — but their seat is on screen, and that is where the
 * card should appear to come from. Both opponents sit in a row across the top,
 * spaced by `justify-around` inside padding that changes at the sm breakpoint,
 * so a fixed offset from the table would be wrong on every viewport but one.
 *
 * Falls back to an offset when the seat is not on screen — mid-deal, or a
 * spectator layout that renders the seats elsewhere.
 */
function seatSource(origin: PlayOrigin, to: FlightRect, baseW: number): FlightRect {
  const w = baseW * 0.6;
  const h = (to.h / to.w) * w;
  const rot = origin === 'left' ? -16 : origin === 'right' ? 16 : 0;

  if (origin === 'left' || origin === 'right') {
    const el = typeof document === 'undefined'
      ? null
      : document.querySelector('[data-ddz-seat="' + origin + '"]');
    if (el) {
      const r = el.getBoundingClientRect();
      return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w, h, rot };
    }
    return { cx: to.cx + (origin === 'left' ? -300 : 300), cy: to.cy - 170, w, h, rot };
  }
  // Our own seat, or nobody's: up from the bottom of the screen.
  return { cx: to.cx, cy: to.cy + 260, w, h, rot };
}

export function PlayArea({ lastPlay, playerName, origin = null }: PlayAreaProps) {
  // User-adjustable size of the centre played cards (set from the settings menu).
  const [cardScale, setCardScale] = useState(1);
  useEffect(() => {
    setCardScale(loadCardScale());
    return onCardScaleChange(setCardScale);
  }, []);

  const reduceMotion = useReducedMotion();
  const cardEls = useRef(new Map<string, HTMLDivElement>());
  const [flight, setFlight] = useState<FlightItem[] | null>(null);

  const isBomb = lastPlay?.type === 'bomb';
  const isRocket = lastPlay?.type === 'rocket';
  const isBig = isBomb || isRocket;

  // Identity of the play, so a card that happens to repeat a previous type and
  // rank still launches its own flight.
  const playKey = lastPlay ? lastPlay.cards.map((c) => handLayoutId(c)).join('|') : '';

  /*
   * Launch the flight.
   *
   * Layout effect, not effect: the destinations have to be measured in the same
   * frame the cards mount, before the browser has painted them, or the player
   * sees them appear and then get flown at.
   */
  useIsoLayoutEffect(() => {
    if (!lastPlay?.cards.length || reduceMotion) {
      setFlight(null);
      return;
    }
    // Always consume, even when this play was not ours — a snapshot left behind
    // by a rejected play must not fire on somebody else's turn.
    const recorded = takeHandRects();

    const items: FlightItem[] = [];
    lastPlay.cards.forEach((card, i) => {
      const el = cardEls.current.get(handLayoutId(card));
      if (!el) return;
      const r = el.getBoundingClientRect();
      // Centre and layout size rather than the raw rect: the stack is scaled
      // and tilted, so the rect is the transformed box, but its centre is not
      // moved by either.
      const to: FlightRect = {
        cx: r.left + r.width / 2,
        cy: r.top + r.height / 2,
        w: el.offsetWidth * cardScale,
        h: el.offsetHeight * cardScale,
        rot: 0,
      };
      const from = (origin === 'self' ? recorded?.get(handLayoutId(card)) : undefined)
        ?? seatSource(origin, to, el.offsetWidth);
      items.push({
        card, i, from, to,
        baseW: el.offsetWidth,
        baseH: el.offsetHeight,
        restScale: cardScale,
        tilt: TABLE_TILT,
        className: isBig ? 'ddz-sheen overflow-hidden' : undefined,
      });
    });

    setFlight(items.length ? items : null);
    if (!items.length) return;

    // Belt and braces: a flight interrupted before it completes (a hidden tab
    // stalls the animation loop) must never leave the real cards invisible.
    const cap = FLIGHT_MS + (items.length - 1) * FLIGHT_STAGGER_MS + 600;
    const t = setTimeout(() => setFlight(null), cap);
    return () => clearTimeout(t);
  // cardScale is read, not tracked: resizing mid-flight should not relaunch it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playKey, origin, reduceMotion]);

  const flying = flight !== null;

  return (
    <div className="ddz-scene flex flex-col items-center gap-2 justify-center w-full">
      {/* Last played cards */}
      <AnimatePresence mode="popLayout">
        {lastPlay ? (
          <motion.div
            key={`${lastPlay.type}-${lastPlay.rank}`}
            /* Opacity only. Anything that moves this wrapper would move the
               landing spot out from under a flight that has already been aimed
               at it. The cards carry their own entrance now. */
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 0.8, y: -24, transition: { duration: 0.18 } }}
            transition={{ duration: 0.12 }}
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
                transform: `scale(${cardScale}) rotateX(${TABLE_TILT}deg)`,
                transformOrigin: 'center top',
              }}
            >
              {lastPlay.cards.map((card) => (
                <div
                  key={`${card.suit}-${card.rank}`}
                  ref={(el) => {
                    const id = handLayoutId(card);
                    if (el) cardEls.current.set(id, el);
                    else cardEls.current.delete(id);
                  }}
                  // Held invisible — but laid out, so it can be measured —
                  // until the clone that is flying at it arrives.
                  style={{ visibility: flying ? 'hidden' : 'visible' }}
                >
                  <Card
                    {...card}
                    large
                    className={isBig ? 'ddz-sheen overflow-hidden' : ''}
                  />
                </div>
              ))}
            </div>
          </motion.div>
        ) : (
          <motion.p
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.5 }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
            className="text-white/50 text-sm"
          >
            等待出牌…
          </motion.p>
        )}
      </AnimatePresence>

      {flight && <CardFlight items={flight} onDone={() => setFlight(null)} />}
    </div>
  );
}
