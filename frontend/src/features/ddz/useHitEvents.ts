'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { sfx, type SfxKey } from '@/features/ddz/sfx';
import { hitLevel, labelFor, musicTrack, musicWeight, type HitLevel } from '@/features/ddz/hitTier';
import { impactDelay, type HitEvent } from '@/features/ddz/components/effects/HitBanner';
import type { GameState } from '@/features/ddz/types';

/**
 * Watches the play history and turns each new play into a hit banner plus its
 * audio. Both live here so the visual and the sound can never disagree about
 * which tier a play earned.
 *
 * Tiers 1–5 fire a short stinger. Tiers 6, 7 and comeback own the music channel
 * instead: those are 30–46 second tracks that deliberately outlive the banner
 * and keep playing into the end-of-round screen.
 */
/**
 * A card landing on the table. Emitted for every play, including the ones too
 * small to earn a banner — the table should knock whenever cards hit it.
 */
export interface Knock {
  id: number;
  level: HitLevel;
  /** ms after the play before the visible impact, for the charged tiers. */
  impactAt: number;
}

export function useHitEvents(gameState: GameState) {
  const [event, setEvent] = useState<HitEvent | null>(null);
  const [knock, setKnock] = useState<Knock | null>(null);
  const seq = useRef(0);
  const prevLen = useRef(gameState.playHistory.length);

  const history = gameState.playHistory;
  const { landlordIndex } = gameState;

  useEffect(() => {
    const prev = prevLen.current;
    prevLen.current = history.length;

    // Shrank (new round) or jumped by more than one entry (a reconnect sync
    // replaying the whole history) — neither is a live play, so stay quiet.
    if (history.length <= prev || history.length - prev > 1) return;

    const latest = history[history.length - 1];
    if (!latest?.play?.cards?.length) return;      // a pass

    const level = hitLevel({
      curr: latest.play,
      currPlayer: latest.playerIndex,
      history,
      landlordIndex,
    });
    seq.current += 1;

    // The knock fires for every play — a single 3 still thumps the table, it
    // just doesn't earn a banner.
    setKnock({ id: seq.current, level, impactAt: impactDelay(level) });

    if (level === 0) return;                        // anything under a 2

    const { word, sub } = labelFor(level, latest.play.type as string, latest.play.rank, latest.play.cards.length);
    setEvent({ id: seq.current, level, word, sub });

    const track = musicTrack(level);
    if (track) {
      sfx.playMusic(track, musicWeight(level));
    } else {
      sfx.play(`tier${level}` as SfxKey);
    }
  }, [history, landlordIndex]);

  // Stop the music if the board unmounts entirely (leaving the room).
  useEffect(() => () => sfx.stopMusic(), []);

  const clear = useCallback(() => setEvent(null), []);
  return { event, knock, clear };
}
