'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { sfx, type SfxKey } from '@/features/ddz/sfx';
import { hitLevel, isOpeningPlay, labelFor, musicTrack, musicWeight, type HitLevel } from '@/features/ddz/hitTier';
import { bannerPlan, type Beat, type HitEvent } from '@/features/ddz/components/effects/HitBanner';
import type { GameState } from '@/features/ddz/types';

/**
 * Watches the play history and turns each new play into a hit banner plus its
 * audio. Both live here so the visual and the sound can never disagree about
 * which tier a play earned.
 *
 * Tiers 1–5 get a short stinger. Tiers 6, 7, comeback and friendly fire own the
 * music channel instead: those are 23–46 second tracks that deliberately outlive
 * the banner and keep playing into the end-of-round screen. The rocket also
 * opens cold — see Preroll.
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
  /**
   * Every jolt the play earns, ms from the banner start — one per glyph plus
   * the second blast. Empty on the light tiers, which take a single knock.
   */
  beats: Beat[];
}

/**
 * The 火箭 cold open.
 *
 * A rocket does not cut straight to its banner. The table holds still, the
 * player's own avatar says the line, and only when the cue finishes does
 * anything else happen — so the wind-up belongs to the player who fired it
 * rather than to the effect.
 */
export interface Preroll {
  id: number;
  /** Seat index of whoever fired it, for anchoring the bubble. */
  playerIndex: number;
  line: string;
}

const GOD_LINE = 'モンスターではない、神だ !!';
const GOD_CUE = '/sounds/kamida.mp3';
/** Rides on top of the tier-7 track and ends well before it. That is intended. */
const GOD_IMPACT = '/sounds/god_hand_impact.mp3';
/**
 * How long to hold the cold open when the audio cannot tell us.
 *
 * Muted, blocked or missing audio gives no 'ended' event, and a rocket that
 * silently never fires its banner would be far worse than one that starts a
 * beat early. kamida.mp3 is 4.2s; this is that plus room to breathe.
 */
const GOD_CUE_MS = 4600;

export function useHitEvents(gameState: GameState) {
  const [event, setEvent] = useState<HitEvent | null>(null);
  const [knock, setKnock] = useState<Knock | null>(null);
  const [preroll, setPreroll] = useState<Preroll | null>(null);
  const seq = useRef(0);
  const prevLen = useRef(gameState.playHistory.length);

  /**
   * The pending cold open.
   *
   * Deliberately a ref rather than an effect cleanup: a pass landing while the
   * cue plays re-runs the effect, and tearing the timer down there would cancel
   * the rocket's banner before it ever started.
   */
  const pending = useRef<{ cancel: () => void } | null>(null);

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
    const id = seq.current;

    // 天堂製造: 20 cards is the landlord's entire hand, so a four-group 飛機帶對
    // as the opening play of the round wins off the deal. hitLevel() reads the
    // same flag for the tier, so the two can never disagree about which hand
    // this is.
    const type = latest.play.type as string;
    const firstWin = isOpeningPlay(history);
    const { word, sub } = labelFor(level, type, latest.play.rank, latest.play.cards.length, firstWin);
    const plan = bannerPlan(level, word, type);
    // Tier 7 holds 天堂製造 as well now, and the cold open is the rocket's.
    const isRocket = type === 'rocket';

    const launch = () => {
      // The knock fires for every play — a single 3 still thumps the table, it
      // just doesn't earn a banner. It reads the banner's own plan so the table
      // shakes on exactly the beats the word lands on.
      setKnock({ id, level, impactAt: plan.charge, beats: plan.beats });
      if (level === 0) return;                      // anything under a 2

      setEvent({ id, level, word, sub, type });

      const track = musicTrack(level);
      if (track) sfx.playMusic(track, musicWeight(level));
      else sfx.play(`tier${level}` as SfxKey);
      // The rocket lands on two channels at once: its track, and the impact.
      if (isRocket) sfx.playFile(GOD_IMPACT);
    };

    // A newer play supersedes anything still winding up.
    pending.current?.cancel();
    pending.current = null;

    if (!isRocket) {
      launch();
      return;
    }

    setPreroll({ id, playerIndex: latest.playerIndex, line: GOD_LINE });
    // Whatever a bomb or a comeback left running is over: the cold open is a
    // silence with one voice in it, and tier 7's own track follows it anyway.
    sfx.stopMusic();
    const cue = sfx.playFile(GOD_CUE);
    const go = () => {
      pending.current = null;
      cue?.removeEventListener('ended', go);
      clearTimeout(timer);
      setPreroll(null);
      launch();
    };
    // The timer is a safety net, not the schedule: 'ended' is what normally
    // starts the banner, and an audio element that dies quietly still has to
    // hand the round back.
    const wait = cue && isFinite(cue.duration) && cue.duration > 0
      ? Math.max(GOD_CUE_MS, cue.duration * 1000 + 400)
      : GOD_CUE_MS;
    const timer = setTimeout(go, wait);
    cue?.addEventListener('ended', go, { once: true });
    pending.current = {
      cancel: () => {
        cue?.removeEventListener('ended', go);
        clearTimeout(timer);
        setPreroll(null);
      },
    };
  }, [history, landlordIndex]);

  // Stop the music if the board unmounts entirely (leaving the room).
  useEffect(() => () => {
    pending.current?.cancel();
    sfx.stopMusic();
  }, []);

  const clear = useCallback(() => setEvent(null), []);
  return { event, knock, preroll, clear };
}
