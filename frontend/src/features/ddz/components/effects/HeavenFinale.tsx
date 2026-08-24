'use client';

import { useMemo } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useReducedMotion } from 'framer-motion';
import { GodBubble } from './GodBubble';
import { LEVEL_LABEL } from '@/features/ddz/hitTier';
import { HEAVEN_BANNER_MS, HEAVEN_LINE, type HeavenState } from '@/features/ddz/heavenFinale';
import type { PlayOrigin } from '@/features/ddz/components/PlayArea';

/**
 * The 天堂製造 finale: a line from the winner's seat, then the words.
 *
 * Rendered at page level, beside the result screen rather than inside the
 * board, because the server resets the room — and unmounts the board — while
 * this is still playing.
 *
 * The banner deliberately does none of what the hit banners do: no shake, no
 * per-glyph whacks, no detonation. The word arrives whole and stays. A game
 * ending is not a hit.
 */
export function HeavenFinale({ state, seatOf }: {
  state: HeavenState;
  /** Maps a seat index to where that player sits on this screen. */
  seatOf: (playerIndex: number) => PlayOrigin;
}) {
  const reduce = useReducedMotion();

  // Gold, seeded off the index so it looks scattered without a random per render.
  const gold = useMemo(
    () => Array.from({ length: 44 }, (_, i) => ({
      x: (i * 149) % 100,
      s: 3 + ((i * 29) % 6),
      r: ((i * 197) % 900) + 360,
      d: 2600 + ((i * 71) % 1400),
      delay: (i % 8) * 110,
    })),
    [],
  );

  return (
    <>
      <AnimatePresence>
        {state.phase === 'bubble' && (
          <GodBubble key="heaven-bubble" origin={seatOf(state.playerIndex)} text={HEAVEN_LINE} />
        )}
      </AnimatePresence>

      {state.phase === 'banner' && (
        <div
          className="hb"
          data-tier="heaven"
          aria-hidden="true"
          style={{ ['--hb' as string]: '#fde047', ['--sp' as string]: 1 }}
        >
          {!reduce && (
            <>
              <div className="hb-godray" style={{ animationDuration: `${HEAVEN_BANNER_MS}ms` }} />
              {gold.map((g, i) => (
                <div
                  key={i}
                  className="hb-gold"
                  style={{
                    ['--x' as string]: `${g.x}%`,
                    ['--s' as string]: `${g.s}px`,
                    ['--r' as string]: `${g.r}deg`,
                    ['--d' as string]: `${g.d}ms`,
                    animationDelay: `${g.delay}ms`,
                  }}
                />
              ))}
            </>
          )}
          <div className="hb-banner hb-serene" style={{ ['--od' as string]: `${HEAVEN_BANNER_MS}ms` }}>
            <span className="hb-word">
              <span className="hb-stroke" aria-hidden="true">{LEVEL_LABEL.heaven.word}</span>
              <span className="hb-fill">{LEVEL_LABEL.heaven.word}</span>
            </span>
            <span className="hb-sub">{LEVEL_LABEL.heaven.sub}</span>
          </div>
        </div>
      )}
    </>
  );
}
