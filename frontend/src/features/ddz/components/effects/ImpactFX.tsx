'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

export type ImpactKind = 'bomb' | 'rocket';

export interface Impact {
  /** Monotonic id so replaying the same hand type still retriggers the burst. */
  id: number;
  kind: ImpactKind;
}

const PARTICLES = 22;

const PALETTE: Record<ImpactKind, { flash: string; ring: string; spark: string[] }> = {
  bomb: {
    flash: 'rgba(255, 214, 140, 0.95)',
    ring: 'rgba(251, 146, 60, 0.9)',
    spark: ['#fde68a', '#fb923c', '#ef4444', '#fca5a5'],
  },
  rocket: {
    flash: 'rgba(196, 224, 255, 0.95)',
    ring: 'rgba(96, 165, 250, 0.9)',
    spark: ['#e0f2fe', '#60a5fa', '#a78bfa', '#f0abfc'],
  },
};

/**
 * The burst that fires when a 炸彈 or 火箭 hits the table. Detected entirely from
 * `lastPlay.type`, which the server already sends, so no protocol change.
 */
export function ImpactFX({ impact }: { impact: Impact | null }) {
  const reduce = useReducedMotion();
  if (reduce) return null;

  const palette = impact ? PALETTE[impact.kind] : PALETTE.bomb;

  return (
    <AnimatePresence>
      {impact && (
        <motion.div
          key={impact.id}
          className="pointer-events-none fixed inset-0 z-[75] overflow-hidden"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.2 } }}
        >
          {/* Full-frame flash */}
          <motion.div
            className="absolute inset-0"
            style={{
              background: `radial-gradient(circle at 50% 45%, ${palette.flash} 0%, rgba(0,0,0,0) 62%)`,
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.85, 0] }}
            transition={{ duration: 0.5, times: [0, 0.08, 1], ease: 'easeOut' }}
          />

          {/* Two shockwave rings, the second trailing the first */}
          {[0, 0.09].map((delay, i) => (
            <motion.div
              key={i}
              className="absolute left-1/2 top-[45%] rounded-full"
              style={{
                width: 120,
                height: 120,
                marginLeft: -60,
                marginTop: -60,
                border: `3px solid ${palette.ring}`,
              }}
              initial={{ scale: 0.2, opacity: 0.9 }}
              animate={{ scale: [0.2, 7 - i * 1.8], opacity: [0.9, 0] }}
              transition={{ duration: 0.75, delay, ease: 'easeOut' }}
            />
          ))}

          {/* Radial sparks */}
          {Array.from({ length: PARTICLES }).map((_, i) => {
            const angle = (i / PARTICLES) * Math.PI * 2 + (impact.id % 7) * 0.11;
            // Deterministic pseudo-jitter keyed off the index — no per-frame RNG.
            const dist = 150 + ((i * 137) % 190);
            const size = 5 + ((i * 53) % 9);
            return (
              <motion.div
                key={i}
                className="absolute left-1/2 top-[45%] rounded-full"
                style={{
                  width: size,
                  height: size,
                  marginLeft: -size / 2,
                  marginTop: -size / 2,
                  background: palette.spark[i % palette.spark.length],
                  boxShadow: `0 0 ${size * 2}px ${palette.spark[i % palette.spark.length]}`,
                }}
                initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
                animate={{
                  x: Math.cos(angle) * dist,
                  // Gravity pulls the tail of the burst downward.
                  y: Math.sin(angle) * dist * 0.72 + 90,
                  opacity: [1, 1, 0],
                  scale: [1, 1.25, 0.3],
                }}
                transition={{ duration: 0.85, ease: [0.16, 0.9, 0.35, 1] }}
              />
            );
          })}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
