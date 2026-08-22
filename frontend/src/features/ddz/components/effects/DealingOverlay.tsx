'use client';

import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { CardBack } from '../Card';

/**
 * Full-screen dealing flourish: card backs tumble out of the middle of the table
 * to the three seats while the server is dealing.
 *
 * Purely decorative — it renders off `phase === 'dealing'` and never gates any
 * state. Whatever the backend sends lands underneath it.
 */

/** Seat targets as a fraction of the viewport, measured from the centre. */
const SEATS = [
  { x: 0, y: 0.36 },       // bottom — the local player
  { x: -0.26, y: -0.34 },  // top-left
  { x: 0.26, y: -0.34 },   // top-right
];

const CARDS_PER_SEAT = 7;
const STAGGER = 0.042;

export function DealingOverlay() {
  const reduce = useReducedMotion();
  const [vp, setVp] = useState<{ w: number; h: number } | null>(null);

  // Targets are pixel offsets, so we need real viewport numbers rather than
  // percentages (which framer-motion would resolve against the card, not the
  // container).
  useEffect(() => {
    const measure = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  if (!vp || reduce) return null;

  const total = CARDS_PER_SEAT * SEATS.length;

  return (
    <motion.div
      className="pointer-events-none fixed inset-0 z-[70] overflow-hidden ddz-scene"
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.25 } }}
    >
      {/* Warm pool of light under the deck while it is being dealt */}
      <motion.div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          width: 320,
          height: 320,
          background: 'radial-gradient(circle, rgba(250,204,21,0.22) 0%, rgba(250,204,21,0) 70%)',
        }}
        initial={{ scale: 0.4, opacity: 0 }}
        animate={{ scale: [0.4, 1.15, 1], opacity: [0, 1, 0.7] }}
        transition={{ duration: 0.7, ease: 'easeOut' }}
      />

      {Array.from({ length: total }).map((_, i) => {
        const seat = SEATS[i % SEATS.length];
        const round = Math.floor(i / SEATS.length);
        // Spread the cards for a seat into a small fan so they don't stack
        // perfectly on top of each other on arrival.
        const jitterX = (round - (CARDS_PER_SEAT - 1) / 2) * 13;
        const jitterY = (round - (CARDS_PER_SEAT - 1) / 2) * 3;
        return (
          <motion.div
            key={i}
            className="absolute left-1/2 top-1/2 preserve-3d"
            style={{ marginLeft: -30, marginTop: -43 }}
            initial={{ x: 0, y: 0, rotateY: 0, rotateZ: 0, scale: 0.7, opacity: 0 }}
            animate={{
              x: seat.x * vp.w + jitterX,
              y: seat.y * vp.h + jitterY,
              rotateY: 540,
              rotateZ: (seat.x === 0 ? 0 : seat.x > 0 ? 22 : -22) + round * 2,
              scale: 1,
              opacity: [0, 1, 1, 0],
            }}
            transition={{
              delay: i * STAGGER,
              duration: 0.6,
              ease: [0.22, 0.75, 0.3, 1],
              opacity: { delay: i * STAGGER, duration: 0.6, times: [0, 0.12, 0.75, 1] },
            }}
          >
            <CardBack />
          </motion.div>
        );
      })}
    </motion.div>
  );
}
