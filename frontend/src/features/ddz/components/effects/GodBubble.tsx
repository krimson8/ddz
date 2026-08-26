'use client';

import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import type { PlayOrigin } from '@/features/ddz/components/PlayArea';

/** Where the bubble sits on screen, and which edge its tail hangs off. */
interface Anchor {
  x: number;
  y: number;
  /** 'below' hangs under a top seat; 'above' sits over the bottom seat. */
  side: 'below' | 'above';
}

/** Half the widest the bubble is allowed to get, for keeping it on screen. */
const HALF = 170;

/**
 * Measure the seat the line belongs to.
 *
 * The seats are laid out with justify-around inside padding that changes at the
 * sm breakpoint, so there is no fixed offset that is right on more than one
 * viewport — the same reason the card flight measures them rather than guessing.
 * Measured once, as the component's initial state rather than from an effect:
 * the seats are already on screen and already laid out, so reading them during
 * the first render is both correct and one frame earlier than an effect would
 * be. The bubble is keyed by event id and remounts per rocket, so there is
 * nothing to re-measure over its lifetime.
 */
function anchorFor(origin: PlayOrigin, half: number): Anchor | null {
  if (typeof document === 'undefined') return null;
  const el = document.querySelector(`[data-ddz-seat="${origin ?? 'self'}"]`);
  const vw = window.innerWidth;
  if (el) {
    const r = el.getBoundingClientRect();
    const below = origin === 'left' || origin === 'right';
    return {
      x: Math.min(Math.max(r.left + r.width / 2, half + 8), vw - half - 8),
      y: below ? r.bottom + 12 : r.top - 12,
      side: below ? 'below' : 'above',
    };
  }
  // Seat off-screen — spectator layouts, or mid-deal. Speak from the table.
  return { x: vw / 2, y: window.innerHeight - 220, side: 'above' };
}

/**
 * The line a 火箭 opens with, spoken from its own player's avatar.
 *
 * Fixed rather than absolute on purpose: the board it sits over is a
 * transformed element while the table is shaking, and a transformed ancestor
 * would become this thing's containing block.
 */
export function GodBubble({ origin, text, half = HALF }: {
  origin: PlayOrigin;
  text: string;
  /** Half the widest this line may get. 黑棺's is three times the rocket's. */
  half?: number;
}) {
  const [at] = useState<Anchor | null>(() => anchorFor(origin, half));
  const reduce = useReducedMotion();

  if (!at) return null;

  const above = at.side === 'above';

  return (
    <motion.div
      className="fixed z-[80] pointer-events-none"
      style={{
        left: at.x,
        top: at.y,
        transform: `translate(-50%, ${above ? '-100%' : '0'})`,
        maxWidth: `${half * 2}px`,
      }}
      initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.55, y: above ? 14 : -14 }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={reduce ? { duration: 0.2 } : { type: 'spring', stiffness: 520, damping: 17 }}
    >
      <div className="relative">
        {/* The glow is a sibling rather than a box-shadow so it can pulse
            without the text riding the same animation. */}
        <motion.div
          className="absolute -inset-2 rounded-2xl blur-lg"
          style={{ background: 'radial-gradient(circle, rgba(253,224,71,.55), rgba(253,224,71,0) 70%)' }}
          animate={reduce ? { opacity: 0.5 } : { opacity: [0.35, 0.8, 0.35] }}
          transition={reduce ? {} : { duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
        />
        <div
          className="relative rounded-2xl border-2 px-4 py-2.5 text-center"
          style={{
            borderColor: 'rgba(253,224,71,.9)',
            background: 'linear-gradient(160deg, rgba(12,20,16,.97), rgba(28,22,6,.97))',
            boxShadow: '0 10px 30px rgba(0,0,0,.6)',
          }}
        >
          <span
            className="block text-[15px] sm:text-[17px] font-bold leading-snug tracking-wide"
            style={{
              fontFamily: '"Hiragino Kaku Gothic ProN", "Yu Gothic", "Meiryo", system-ui, sans-serif',
              color: '#fff',
              textShadow: '0 0 12px rgba(253,224,71,.85), 0 2px 3px rgba(0,0,0,.9)',
            }}
          >
            {text}
          </span>
        </div>
        {/* Tail: a rotated square tucked under the border so only its outer
            corner shows, which is cheaper than clipping a real triangle. */}
        <div
          className="absolute left-1/2 w-3 h-3 rotate-45 border-2"
          style={{
            borderColor: 'rgba(253,224,71,.9)',
            background: above ? 'rgba(28,22,6,.97)' : 'rgba(12,20,16,.97)',
            marginLeft: -6,
            [above ? 'bottom' : 'top']: -7,
            clipPath: above
              ? 'polygon(100% 0, 100% 100%, 0 100%)'
              : 'polygon(0 0, 100% 0, 0 100%)',
          }}
        />
      </div>
    </motion.div>
  );
}
