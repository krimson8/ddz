'use client';

import { useMemo } from 'react';
import { useReducedMotion } from 'framer-motion';

const GOLD = ['#fde047', '#facc15', '#f59e0b', '#fca5a5', '#fb7185', '#fff7cc'];
const GREEN = ['#86efac', '#4ade80', '#22d3ee', '#67e8f9', '#a7f3d0', '#ecfeff'];

interface ConfettiProps {
  /** Colour scheme — landlord wins get gold, peasants get green. */
  tone?: 'gold' | 'green';
  /** How many pieces to drop. */
  count?: number;
}

/**
 * Win celebration. Deliberately plain DOM driven by a CSS keyframe rather than
 * per-frame JS: one composited transform per piece, no React work after mount.
 */
export function Confetti({ tone = 'gold', count = 90 }: ConfettiProps) {
  const reduce = useReducedMotion();

  // Positions are derived from the index so the layout is stable across the
  // re-renders that happen while the result banner is on screen.
  const pieces = useMemo(() => {
    const palette = tone === 'gold' ? GOLD : GREEN;
    return Array.from({ length: count }, (_, i) => {
      const r1 = ((i * 9301 + 49297) % 233280) / 233280;
      const r2 = ((i * 4801 + 9973) % 233280) / 233280;
      const r3 = ((i * 7717 + 3571) % 233280) / 233280;
      return {
        left: r1 * 100,
        drift: (r2 - 0.5) * 34,
        spin: 360 + r3 * 1080,
        delay: r2 * 1.6,
        duration: 2.4 + r3 * 2.0,
        width: 6 + r1 * 7,
        height: 9 + r3 * 9,
        color: palette[i % palette.length],
        round: i % 5 === 0,
      };
    });
  }, [tone, count]);

  if (reduce) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[65] overflow-hidden">
      {pieces.map((p, i) => (
        <span
          key={i}
          className="absolute top-0 block"
          style={
            {
              left: `${p.left}%`,
              width: p.width,
              height: p.height,
              background: p.color,
              borderRadius: p.round ? '9999px' : '1px',
              animation: `ddz-confetti ${p.duration}s linear ${p.delay}s infinite`,
              '--dx': `${p.drift}vw`,
              '--spin': `${p.spin}deg`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
