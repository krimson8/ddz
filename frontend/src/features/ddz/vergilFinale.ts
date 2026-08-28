'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { sfx } from '@/features/ddz/sfx';

import type { GameState, HistoryEntry } from '@/features/ddz/types';

/**
 * 閻魔刀 — the finish nobody was allowed to answer.
 *
 * The other bookend to 黑棺. That one is the round taken off an enemy's play;
 * this is the round taken while the table could only watch — you led, everyone
 * passed, you led again and were out. A → 2 → K, and no one ever got a turn
 * that mattered.
 *
 * The two are mutually exclusive by construction rather than by ranking, which
 * is why they can share a rank. 黑棺 needs the newest play to have BEATEN an
 * opposing play; this needs the newest play to follow the winner's own last
 * play, which can only happen after both opponents passed — and a play that
 * follows two passes leads a fresh trick and has beaten nobody. Neither can
 * answer where the other does, so no order between them ever has to be picked.
 *
 * Every number here is the one the lab settled on — frontend/public/fx-lab.html.
 */

export const VERGIL_VIDEO = '/video/vergil.bury.mp4';

/**
 * End of the green-screen half, on the CLIP'S OWN timeline.
 *
 * The clip is two cuts joined by public/video/make-clips.mjs: green screen, and
 * then footage with no green in it at all. The key comes off here — re-cut
 * either half and this mark moves with it.
 */
export const VERGIL_KEY_MS = 3150;

/**
 * Level with 黑棺 (500). Nothing else in the game outranks either, and the two
 * never contend for the channel — see the note above.
 */
export const VERGIL_WEIGHT = 500;

/**
 * When the result screen is allowed through, measured from the first frame.
 *
 * The server resets the room twelve seconds after the round ends (see
 * game.service.ts), so the screen goes up one second before that: it is on
 * screen and settled when the room moves on underneath it, rather than
 * arriving in the same breath.
 *
 * A fixed timer rather than anything the clip reports, deliberately. A video
 * that is blocked, missing or refused fires no events, and the result screen
 * cannot be left waiting on one.
 */
export const VERGIL_BANNER_AT_MS = 11000;

/**
 * A ceiling for the plate, not its schedule.
 *
 * 'ended' is what normally takes it down, and the end screen's dismiss stops it
 * early. The clip is ~29.6s; this is past that with room, so a clip that never
 * reports itself finished still lets go eventually.
 */
const VERGIL_PLATE_MAX_MS = 45000;

export interface VergilWin {
  /** Seat index of whoever emptied their hand. */
  playerIndex: number;
}

/**
 * Did the newest entry win the round on the winner's own second lead?
 *
 * Two conditions about the newest entry: it has to be the winning play — cards
 * on the table, that player's count at zero — and the play before it has to be
 * the same player's. Passes are stepped over, so "the play before it" means the
 * previous entry that actually put cards down; if that one is theirs too, then
 * nobody else played in between, because everyone else could only have passed.
 *
 * Party never comes into it. Being unanswerable is the whole event, and it
 * reads the same whoever was sitting where.
 *
 * Card counts and history arrive in the same GAME_STATE action, so the zero
 * here belongs to the play being examined rather than to a later snapshot.
 */
export function vergilWin(
  history: HistoryEntry[],
  cardCounts: number[],
): VergilWin | null {
  const latest = history[history.length - 1];
  if (!latest?.play?.cards?.length) return null;
  if (cardCounts[latest.playerIndex] !== 0) return null;   // not the winning play

  for (let i = history.length - 2; i >= 0; i--) {
    const entry = history[i];
    if (!entry.play?.cards?.length) continue;              // a pass, or a surrender
    return entry.playerIndex === latest.playerIndex
      ? { playerIndex: latest.playerIndex }
      : null;                                              // somebody else got in
  }
  return null;                                             // nothing before it
}

/** What the finale is showing right now. */
export type VergilPhase = 'idle' | 'plate';

export interface VergilState {
  phase: VergilPhase;
  playerIndex: number;
  /**
   * True while the result screen must stay out of the way.
   *
   * Goes false at VERGIL_BANNER_AT_MS while the clip plays on — unlike 黑棺,
   * which holds until its shutter closes. The clip outlives the round here by
   * design: the screen arrives over the top of it and the music keeps running,
   * the way a tier track does.
   */
  blocking: boolean;
}

const IDLE: VergilState = { phase: 'idle', playerIndex: -1, blocking: false };

/**
 * Drives the finale.
 *
 * Lives at page level, above the board: the server resets the room — unmounting
 * the board — twelve seconds into a clip that runs for thirty.
 */
export function useVergilFinale(gameState: GameState) {
  const [state, setState] = useState<VergilState>(IDLE);
  const prevLen = useRef(gameState.playHistory.length);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const history = gameState.playHistory;
  const counts = gameState.playerCardCounts;

  useEffect(() => {
    const prev = prevLen.current;
    prevLen.current = history.length;
    // Shrank (new round) or jumped (a reconnect replaying the whole history) —
    // neither is a live play.
    if (history.length <= prev || history.length - prev > 1) return;

    const win = vergilWin(history, counts);
    if (!win) return;

    /** The clip, and the one mark on the wall clock that matters. */
    const begin = ({ playerIndex }: VergilWin) => {
      // Whatever the round left running is over — including a turn alert
      // mid-sentence. Ducking after stopping, not before: stopMusic lifts it.
      // The clip's own track takes the music slot once it is playing; see the
      // plate, which adopts it.
      sfx.stopMusic();
      sfx.duckCues(true);
      setState({ phase: 'plate', playerIndex, blocking: true });

      const at = (fn: () => void, d: number) => timers.current.push(setTimeout(fn, d));
      // The result screen goes up over the clip, a second before the server's
      // reset lands. The clip keeps playing behind and past it.
      at(
        () => setState((s) => (s.phase === 'plate' ? { ...s, blocking: false } : s)),
        VERGIL_BANNER_AT_MS,
      );
    };

    begin(win);
  }, [history, counts]);

  /**
   * The clip is done with — finished, stopped from the end screen, or given up
   * on. Lifting the duck here is what lets a turn alert be heard again in the
   * lobby afterwards.
   */
  const end = useCallback(() => {
    setState((s) => (s.phase === 'plate' ? IDLE : s));
    sfx.duckCues(false);
  }, []);

  // Leaving the page is the only real interruption, and the component goes with
  // it — pausing the clip on the way out, which is what stops a detached
  // <video> singing on in the background.
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  return { state, end, plateMaxMs: VERGIL_PLATE_MAX_MS };
}
