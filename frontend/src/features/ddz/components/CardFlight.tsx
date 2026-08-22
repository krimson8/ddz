'use client';

import { createPortal } from 'react-dom';
import { motion, type Transition } from 'framer-motion';
import { Card } from './Card';
import {
  FLIGHT_IMPACT_AT,
  FLIGHT_MS,
  FLIGHT_STAGGER_MS,
  type FlightRect,
} from '@/features/ddz/cardFlight';
import type { Card as CardType } from '@/features/ddz/types';

export interface FlightItem {
  card: CardType;
  /** Order in the play — drives the stagger. */
  i: number;
  from: FlightRect;
  to: FlightRect;
  /** Natural (untransformed) size of the destination card, for the scale maths. */
  baseW: number;
  baseH: number;
  /** Resting scale of the table stack, from the player's card-size setting. */
  restScale: number;
  /** Table tilt the card settles into, in degrees about X. */
  tilt: number;
  /** Extra classes for the clone — the bomb/rocket sheen sweeps mid-flight. */
  className?: string;
}

/**
 * Where the flight is drawn: the same element the board shake is applied to.
 *
 * Not `document.body`. The card lands at the exact moment the table starts
 * shaking, and the swap from clone to real card has to be invisible — which it
 * only is if both are being moved by the same transform. Nothing between this
 * host and the play area clips, so a card can cross the whole board.
 */
const HOST_ID = 'ddz-board';

export function CardFlight({ items, onDone }: { items: FlightItem[]; onDone: () => void }) {
  // Resolved during render rather than in an effect: an effect would cost a
  // commit, and a flight that starts one frame late is a flight the player sees
  // the tail of. Nothing is mutated here — it is a lookup.
  const host = typeof document === 'undefined'
    ? null
    : document.getElementById(HOST_ID) ?? document.body;

  if (!host || !items.length) return null;

  // Viewport → host coordinates. Measured now, in the same frame the play area
  // measured its destinations, so the shake has not started moving either one.
  const origin = host.getBoundingClientRect();
  const last = items[items.length - 1];

  return createPortal(
    <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 30 }} aria-hidden="true">
      {items.map((it) => {
        const { from, to, baseW, baseH, restScale, tilt, i } = it;
        const delay = (i * FLIGHT_STAGGER_MS) / 1000;

        const fx = from.cx - origin.left, fy = from.cy - origin.top;
        const tx = to.cx - origin.left, ty = to.cy - origin.top;

        // Scale is relative to the destination card's natural size, so a hand
        // card (smaller) starts under 1 and the table stack rests at whatever
        // the player's size setting says.
        const s0 = from.w / baseW;
        const peak = restScale * 1.22;   // rises toward the camera mid-flight

        // Apex of the arc: most of the way across, and lifted off the line.
        const mx = fx + (tx - fx) * 0.62;
        const my = fy + (ty - fy) * 0.62 - 54;

        const timing: Transition = {
          duration: FLIGHT_MS / 1000,
          times: [0, FLIGHT_IMPACT_AT * 0.775, FLIGHT_IMPACT_AT, 1],
          // Out of the hand, accelerating into the table, then a soft settle.
          ease: [[0.25, 0.6, 0.3, 1], [0.55, 0, 0.95, 0.5], [0.2, 0.9, 0.3, 1]],
          delay,
        };

        return (
          <motion.div
            key={`${it.card.suit}-${it.card.rank}`}
            className="absolute top-0 left-0"
            style={{
              width: baseW,
              height: baseH,
              marginLeft: -baseW / 2,
              marginTop: -baseH / 2,
              perspective: 1400,
            }}
            initial={{ x: fx, y: fy }}
            animate={{ x: [fx, mx, tx, tx], y: [fy, my, ty, ty] }}
            transition={timing}
            onAnimationComplete={it === last ? onDone : undefined}
          >
            <motion.div
              className="w-full h-full"
              initial={{ scaleX: s0, scaleY: s0, rotate: from.rot, rotateX: 0 }}
              animate={{
                // Squash on contact, then settle. Separate axes, because the
                // whole point of an impact frame is that it is not uniform.
                scaleX: [s0, peak, restScale * 1.14, restScale],
                scaleY: [s0, peak, restScale * 0.85, restScale],
                rotate: [from.rot, from.rot * 0.3, 0, 0],
                // Faces the player in the air, lies down onto the table.
                rotateX: [0, 0, tilt, tilt],
              }}
              transition={timing}
            >
              <Card {...it.card} large className={it.className} />
            </motion.div>
          </motion.div>
        );
      })}

      {/* Dust ring, thrown out from under each card the moment it connects. */}
      {items.map((it) => (
        <div
          key={`dust-${it.card.suit}-${it.card.rank}`}
          className="ddz-dust"
          style={{
            left: it.to.cx - origin.left,
            top: it.to.cy - origin.top + (it.baseH * it.restScale) / 2,
            animationDelay: `${it.i * FLIGHT_STAGGER_MS + FLIGHT_MS * FLIGHT_IMPACT_AT}ms`,
          }}
        />
      ))}
    </div>,
    host,
  );
}
