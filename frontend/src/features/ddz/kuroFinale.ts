'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { sfx } from '@/features/ddz/sfx';
import { beatenEntry, partyOf, playSeq } from '@/features/ddz/hitTier';

import type { GameState, HistoryEntry } from '@/features/ddz/types';

/**
 * 黑棺 — the finish taken off an enemy.
 *
 * Not a hand and not a tier: a way of ending the round. Emptying your hand on a
 * play that beats the OTHER side takes the whole moment — the table holds, the
 * line is said, the clip runs, and the round's result screen arrives behind a
 * blackout rather than on its own.
 *
 * It outranks everything, 火箭 and 天堂製造 included. Where those two queue and
 * defer to each other, this replaces them: see useHitEvents.ts and
 * heavenFinale.ts, both of which stand down when kuroWin() answers.
 *
 * Every number here is the one the lab settled on — frontend/public/fx-lab.html.
 */

export const KYOKA_LINE = '一体 いつから鏡花水月を使っていないと錯覚していた';

const KYOKA_CUE = '/sounds/kyoka.mp3';
/** The bed. Comes up with the line and plays through everything after it. */
const VOIS_TRACK = '/sounds/vois_sur.mp3';
/** Above HEAVEN_WEIGHT (400): nothing outranks 黑棺. */
const KURO_WEIGHT = 500;
/** The bed swells 0 → full across this, from silence. */
const VOIS_FADE_MS = 5000;

/**
 * How long to hold the line when the audio cannot tell us.
 *
 * Muted or blocked audio fires no 'ended' event, and a finale that never
 * reaches its clip would strand the result screen behind it. kyoka.mp3 is
 * 4.4s; this is that plus room to breathe.
 */
const KYOKA_CUE_MS = 4800;

export const KURO_VIDEO = '/video/kuro_hitsugi.mp4';
/**
 * The two knobs on the clip.
 *
 * KURO_TARGET_MS is what the whole 22.1s source would take if it ran fast the
 * whole way, so the rate is simply duration ÷ target. KURO_UNMUTE_AT_MS is a
 * mark on the CLIP'S OWN timeline, not on the wall clock: from there it runs at
 * 1× with its own audio. Real runtime is mark ÷ rate + (duration − mark).
 */
export const KURO_TARGET_MS = 2000;
export const KURO_UNMUTE_AT_MS = 18000;

/** Close, hold, open. The result screen mounts as the leaves meet. */
export const SHUTTER = { close: 500, hold: 1000, open: 500 };
const SHUTTER_TOTAL = SHUTTER.close + SHUTTER.hold + SHUTTER.open;

/**
 * A safety net for the clip, not its schedule.
 *
 * 'ended' is what normally closes the shutter. A video that is blocked, fails
 * to load, or is killed by a backgrounded tab fires nothing, and the result
 * screen is waiting behind it — so a generous ceiling hands the round back
 * anyway. The clip is ~5.3s at the lab's settings; this is far past that.
 */
const KURO_PLATE_MAX_MS = 30000;

export interface KuroWin {
  /** Seat index of whoever emptied their hand. */
  playerIndex: number;
}

/**
 * Did the newest entry win the round on a play taken off the other side?
 *
 * Two conditions, both about the newest entry. It has to be the winning play —
 * cards on the table and that player's count at zero — and the play it beat has
 * to belong to the opposing party. beatenEntry() is what makes the second one
 * honest: a play that follows two passes leads a fresh trick and has beaten
 * nobody, so going out on it is not this.
 *
 * Landlord over either peasant, or either peasant over the landlord. Peasant
 * over peasant is the same side and never qualifies, however the round ends.
 *
 * Card counts and history arrive in the same GAME_STATE action, so the zero
 * here belongs to the play being examined rather than to a later snapshot.
 */
export function kuroWin(
  history: HistoryEntry[],
  cardCounts: number[],
  landlordIndex: number | null,
): KuroWin | null {
  if (landlordIndex === null || landlordIndex < 0) return null;
  const latest = history[history.length - 1];
  if (!latest?.play?.cards?.length) return null;
  if (cardCounts[latest.playerIndex] !== 0) return null;   // not the winning play

  const beaten = beatenEntry(history);
  if (!beaten?.play) return null;                          // led the trick, beat nobody
  const mine = partyOf(latest.playerIndex, landlordIndex);
  const theirs = partyOf(beaten.playerIndex, landlordIndex);
  if (mine === theirs) return null;                        // own side

  return { playerIndex: latest.playerIndex };
}

/** What the finale is showing right now. */
export type KuroPhase = 'idle' | 'bubble' | 'plate' | 'shutter';

export interface KuroState {
  phase: KuroPhase;
  playerIndex: number;
  /**
   * True while the result screen must stay out of the way.
   *
   * Deliberately not the same as "the finale is running". It goes false the
   * instant the leaves meet, which is what puts the result screen on screen
   * while the blackout still covers it — so the shutter opens on a screen that
   * has already finished arriving.
   */
  blocking: boolean;
  /** The play sequence whose cold open is over, and whose cards may land. */
  settledAt: number;
}

const IDLE = { phase: 'idle', playerIndex: -1, blocking: false } as const;

/**
 * Drives the finale.
 *
 * Lives at page level, above the board: the server resets the room — unmounting
 * the board — five seconds into a sequence that runs for eleven.
 */
export function useKuroFinale(gameState: GameState) {
  const [state, setState] = useState<Omit<KuroState, 'settledAt'>>(IDLE);
  const [settledAt, setSettledAt] = useState(-1);
  const prevLen = useRef(gameState.playHistory.length);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const warm = useRef<HTMLVideoElement | null>(null);

  const history = gameState.playHistory;
  const counts = gameState.playerCardCounts;
  const { landlordIndex } = gameState;

  useEffect(() => {
    const prev = prevLen.current;
    prevLen.current = history.length;
    // Shrank (new round) or jumped (a reconnect replaying the whole history) —
    // neither is a live play.
    if (history.length <= prev || history.length - prev > 1) return;

    const win = kuroWin(history, counts, landlordIndex);
    if (!win) return;

    /** The line, then the clip. The shutter is driven by the clip itself. */
    const begin = ({ playerIndex }: KuroWin) => {
      // Whatever the round left running is over — including a turn alert
      // mid-sentence. Ducking after stopping, not before: stopMusic lifts it.
      sfx.stopMusic();
      sfx.duckCues(true);
      setState({ phase: 'bubble', playerIndex, blocking: true });

      // The bed comes up under the line and keeps going, so the cue, the silent
      // head of the clip and the clip's own audio all land on one piece rather
      // than three. It takes the music channel, which is what lets the end
      // screen report it and what stops a later cue talking over it.
      sfx.playMusic(VOIS_TRACK, KURO_WEIGHT, VOIS_FADE_MS);

      // The clip is ~800KB and does not exist on the page until the line is
      // finished, which is a stall exactly where the sequence can least afford
      // one. Warm it in the same breath as the line — four seconds is ample.
      // A detached element rather than a fetch: the real one reads the media
      // cache in ranges, which a whole-file fetch does not populate.
      const pre = document.createElement('video');
      pre.preload = 'auto';
      pre.src = KURO_VIDEO;
      pre.load();
      warm.current = pre;

      const cue = sfx.playFile(KYOKA_CUE);
      const toPlate = () => {
        cue?.removeEventListener('ended', toPlate);
        clearTimeout(cueTimer);
        // The line has been said: the winning cards may land now.
        setSettledAt(playSeq(history));
        warm.current = null;               // the plate reads the cache from here
        // The bed holds the duck. If it could not start — muted, or blocked —
        // nothing is going to lift it, so lift it here.
        if (!sfx.isMusicPlaying()) sfx.duckCues(false);
        setState({ phase: 'plate', playerIndex, blocking: true });
      };
      // The timer is a safety net; 'ended' is the schedule.
      const wait = cue && isFinite(cue.duration) && cue.duration > 0
        ? Math.max(KYOKA_CUE_MS, cue.duration * 1000 + 300)
        : KYOKA_CUE_MS;
      const cueTimer = setTimeout(toPlate, wait);
      timers.current.push(cueTimer);
      cue?.addEventListener('ended', toPlate, { once: true });
    };

    begin(win);
  }, [history, counts, landlordIndex]);

  /**
   * The clip is over: close the leaves.
   *
   * Called from the plate itself on 'ended', and from its own ceiling if that
   * never arrives. Blocking is released one close-length later, not here — the
   * result screen is meant to appear *behind* the black, not before it.
   */
  const closeShutter = useCallback(() => {
    const at = (fn: () => void, d: number) => timers.current.push(setTimeout(fn, d));
    setState((s) => (s.phase === 'plate' ? { ...s, phase: 'shutter' } : s));
    at(() => setState((s) => (s.phase === 'shutter' ? { ...s, blocking: false } : s)), SHUTTER.close);
    at(() => setState((s) => (s.phase === 'shutter' ? IDLE : s)), SHUTTER_TOTAL);
  }, []);

  // Leaving the page is the only real interruption, and the component goes with
  // it. A new round cannot start underneath: the sequence clears itself in ~11s
  // and the room is held behind the result screen until it is dismissed.
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  return { state: { ...state, settledAt } as KuroState, closeShutter, plateMaxMs: KURO_PLATE_MAX_MS };
}
