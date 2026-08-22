'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { sfx, type SfxKey } from '@/features/ddz/sfx';
import { hitLevel, labelFor, musicTrack, musicWeight } from '@/features/ddz/hitTier';
import type { HitEvent } from '@/features/ddz/components/effects/HitBanner';
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
export function useHitEvents(gameState: GameState) {
  const [event, setEvent] = useState<HitEvent | null>(null);
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
    if (level === 0) return;                        // anything under a 2

    const { word, sub } = labelFor(level, latest.play.type as string, latest.play.rank, latest.play.cards.length);
    seq.current += 1;
    setEvent({ id: seq.current, level, word, sub });

    const track = musicTrack(level);
    if (track) {
      sfx.playMusic(track, musicWeight(level, latest.play.rank));
    } else {
      sfx.play(`tier${level}` as SfxKey);
    }
  }, [history, landlordIndex]);

  // Stop the music if the board unmounts entirely (leaving the room).
  useEffect(() => () => sfx.stopMusic(), []);

  const clear = useCallback(() => setEvent(null), []);
  return { event, clear };
}
