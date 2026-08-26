'use client';

import { useEffect, useRef, useState } from 'react';
import { sfx } from '@/features/ddz/sfx';
import { LEVEL_LABEL, playSeq } from '@/features/ddz/hitTier';
import { kuroWin } from '@/features/ddz/kuroFinale';
import { bannerPlan } from '@/features/ddz/components/effects/HitBanner';
import { GOD_CUE_MS } from '@/features/ddz/useHitEvents';
import type { GameState, HistoryEntry } from '@/features/ddz/types';

/**
 * 天堂製造 — the six-turn win.
 *
 * Not a hand you can hold: a way of finishing. Emptying your hand inside six of
 * your own plays earns a cold open and a banner of its own, and the round's
 * result screen waits for it.
 */

export { playSeq };

/** How few plays it takes. The winning play is one of them. */
export const HEAVEN_TURNS = 6;

export const HEAVEN_LINE = 'MADE IN HEAVEN';
const HEAVEN_CUE = '/sounds/made_in_heaven.mp3';
/** 40 seconds, so it plays on under the result screen — as the others do. */
const HEAVEN_TRACK = '/sounds/crucified_full.mp3';
/** Outranks every tier track: nothing follows the end of the game. */
const HEAVEN_WEIGHT = 400;

/**
 * How long to hold the cold open when the audio cannot tell us.
 *
 * Muted or blocked audio fires no 'ended' event, and a finale that never
 * reaches its banner would strand the result screen behind it.
 * made_in_heaven.mp3 is 2.4s; this is that plus room to breathe.
 */
const HEAVEN_CUE_MS = 2800;
/** The banner: fade in together, hold ~2s, fade out. Matches hb-serene. */
export const HEAVEN_BANNER_MS = 3600;

export interface HeavenWin {
  /** Seat index of whoever emptied their hand. */
  playerIndex: number;
  /** How many plays it took them. */
  plays: number;
}

/**
 * Did the newest entry end the game inside HEAVEN_TURNS plays by its player?
 *
 * Passes do not count against the player: a pass makes no progress, so it is
 * not one of the six. A surrender is not a play at all and carries no cards,
 * so it never qualifies.
 *
 * Card counts and history arrive in the same GAME_STATE action, so the zero
 * here belongs to the play being examined rather than to a later snapshot.
 */
export function heavenWin(history: HistoryEntry[], cardCounts: number[]): HeavenWin | null {
  const latest = history[history.length - 1];
  if (!latest?.play?.cards?.length) return null;
  if (cardCounts[latest.playerIndex] !== 0) return null;   // not the winning play
  const plays = history.filter(
    (h) => h.playerIndex === latest.playerIndex && h.play?.cards?.length,
  ).length;
  return plays <= HEAVEN_TURNS ? { playerIndex: latest.playerIndex, plays } : null;
}

/**
 * Does the newest play open cold — does the table wait before its cards land?
 *
 * Pure and synchronous, because the table has to hold on the very first render
 * of the new play. Anything driven from an effect would let a frame of the card
 * flight escape before the dialog had even appeared.
 */
export function coldOpenFor(
  history: HistoryEntry[],
  cardCounts: number[],
  landlordIndex: number | null = null,
): 'rocket' | 'heaven' | 'kuro' | null {
  let i = history.length - 1;
  while (i >= 0 && !history[i].play?.cards?.length) i--;   // step back over passes
  if (i < 0) return null;
  const upto = history.slice(0, i + 1);
  // 黑棺 first: it replaces both of the others when it answers, so asking in
  // any other order would hold the table for a cold open that never comes.
  if (kuroWin(upto, cardCounts, landlordIndex)) return 'kuro';
  if ((history[i].play.type as string) === 'rocket') return 'rocket';
  // heavenWin reads the newest entry, so ask it about the history as it stood
  // when that play landed.
  return heavenWin(upto, cardCounts) ? 'heaven' : null;
}

/** What the finale is showing right now. */
export type HeavenPhase = 'idle' | 'waiting' | 'bubble' | 'banner';

export interface HeavenState {
  phase: HeavenPhase;
  playerIndex: number;
  /** True while the result screen must stay out of the way. */
  blocking: boolean;
  /**
   * The history length whose cold open is over, and whose cards may land.
   *
   * Deliberately outside the phase machine: it must survive the finale
   * returning to idle, or the table would freeze again the moment it ended.
   */
  settledAt: number;
}

const IDLE = { phase: 'idle', playerIndex: -1, blocking: false } as const;

/**
 * A 火箭 keeps its own cold open and banner when it is also the winning play,
 * so the finale queues behind the whole thing rather than cutting it off.
 * Derived rather than signalled, because the board that would signal it may
 * already have unmounted on the server's return_to_lobby by then.
 */
const rocketLead = () =>
  GOD_CUE_MS + bannerPlan(7, LEVEL_LABEL.rocket.word, 'rocket').total + 200;

/**
 * Drives the finale.
 *
 * Lives at page level, above the board: the board unmounts when the server
 * resets the room, and this has to outlive that.
 */
export function useHeavenFinale(gameState: GameState): HeavenState {
  const [state, setState] = useState<Omit<HeavenState, 'settledAt'>>(IDLE);
  const [settledAt, setSettledAt] = useState(-1);
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

    // 黑棺 outranks this and replaces it outright — a win taken off an enemy
    // is not also a 天堂製造, however few turns it took.
    if (kuroWin(history, counts, gameState.landlordIndex)) return;

    const win = heavenWin(history, counts);
    if (!win) return;

    /** Run the whole finale, from the first held breath to the last gold fleck. */
    const begin = (win: HeavenWin, lead: number) => {
      const at = (fn: () => void, d: number) => timers.current.push(setTimeout(fn, d));
      // Blocking from this instant, even while a rocket finishes ahead of it:
      // the result screen must not slip out during the gap.
      setState({ phase: lead ? 'waiting' : 'idle', playerIndex: win.playerIndex, blocking: true });

      at(() => {
        // Whatever the round left running is over. The cold open is a silence
        // with one line in it — including whoever's turn alert is mid-sentence.
        // Ducking after stopping, not before: stopMusic lifts the duck.
        sfx.stopMusic();
        sfx.duckCues(true);
        setState({ phase: 'bubble', playerIndex: win.playerIndex, blocking: true });

        const cue = sfx.playFile(HEAVEN_CUE);
        const toBanner = () => {
          cue?.removeEventListener('ended', toBanner);
          clearTimeout(cueTimer);
          // The line has been said: the cards may land now.
          setSettledAt(playSeq(history));
          sfx.playMusic(HEAVEN_TRACK, HEAVEN_WEIGHT);
          // The track normally inherits the duck. If it could not start —
          // muted, or blocked — nothing is going to lift it, so lift it here.
          if (!sfx.isMusicPlaying()) sfx.duckCues(false);
          setState({ phase: 'banner', playerIndex: win.playerIndex, blocking: true });
          at(() => setState(IDLE), HEAVEN_BANNER_MS);
        };
        // The timer is a safety net; 'ended' is the schedule.
        const wait = cue && isFinite(cue.duration) && cue.duration > 0
          ? Math.max(HEAVEN_CUE_MS, cue.duration * 1000 + 300)
          : HEAVEN_CUE_MS;
        const cueTimer = setTimeout(toBanner, wait);
        timers.current.push(cueTimer);
        cue?.addEventListener('ended', toBanner, { once: true });
      }, lead);
    };

    const latest = history[history.length - 1];
    begin(win, (latest.play.type as string) === 'rocket' ? rocketLead() : 0);
  }, [history, counts, gameState.landlordIndex]);

  // No reset for "a new round started mid-finale": the sequence clears itself
  // after ~6s, the server holds the room for 8, and three players cannot vote a
  // fresh deal in between. Leaving the page is the only real interruption, and
  // the component goes with it.
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  return { ...state, settledAt };
}
