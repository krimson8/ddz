'use client';

import { useEffect, useRef } from 'react';
import { sfx } from '@/features/ddz/sfx';
import type { GameState } from '@/features/ddz/types';

// Map each emoji/reaction text to a sound file under /sounds/emoji/
// Add or remove entries as you add sound files.
const EMOJI_SOUNDS: Record<string, string> = {
  '🖕': '/sounds/emoji/middle-finger.mp3',
  '🤏': '/sounds/emoji/small.mp3',
  '🤌': '/sounds/emoji/chef-kiss.mp3',
  'EZ': '/sounds/emoji/ez.mp3',
  'GG': '/sounds/emoji/gg.mp3',
  '玩不了啦': '/sounds/emoji/wan-bu-liao-la.mp3',
  '小兒科': '/sounds/emoji/xiao-er-ke.ogg',
  '小癟三': '/sounds/emoji/xiao-bie-san1.ogg',
  '不用看了': '/sounds/emoji/bu-yong-kan-le.ogg',
  '在我者離': '/sounds/emoji/zai-wo-zhe-li.ogg',
  '窩妖驗牌': '/sounds/emoji/wo-yao-yan-pai.ogg',
  '牌沒有問題': '/sounds/emoji/pai-mei-you-wen-ti.ogg',
  '給我搽皮鞋': '/sounds/emoji/gei-wo-cha-pixie.ogg',
};

/** Start ticking this many seconds before the turn timer expires. */
const TICK_FROM_SECONDS = 5;

/**
 * Is anything still entitled to the music channel?
 *
 * A live round is, and so is the end-of-round screen — which is exactly the
 * lobby phase with a result still on it, the state the server puts the client
 * in five seconds after the round ends. Once the result is dismissed, aborted
 * or left behind, nothing is, and the track stops.
 */
const holdsMusic = (s: GameState) => s.phase !== 'lobby' || !!s.lastResult;

export function useSoundEffects(gameState: GameState, mySocketId: string) {
  const prevStateRef = useRef<GameState>(gameState);
  const yourTurnAudioRef = useRef<HTMLAudioElement | null>(null);

  // Prime the bus and satisfy iOS's "audio must start in a gesture" rule on the
  // first touch anywhere in the document.
  useEffect(() => {
    sfx.init();
    sfx.preloadFiles(Object.values(EMOJI_SOUNDS));
    const unlock = () => sfx.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  // Navigating away is not a state transition, and the bus is a module
  // singleton that would otherwise keep playing over the next page.
  useEffect(() => () => sfx.stopMusic(), []);

  const playEmoji = (emoji: string) => {
    const src = EMOJI_SOUNDS[emoji];
    if (!src) return; // no sound mapped for this emoji — skip silently
    sfx.playFile(src);
  };

  // ── State-derived cues ─────────────────────────────────────────────────────
  useEffect(() => {
    const prev = prevStateRef.current;
    const curr = gameState;

    // Whether it's the local player's turn to *play* (not bid/draw). Gating on the
    // gameplay phase is what makes the "your turn" cue reliable: currentPlayer also
    // moves around during bidding/roledraw, and without this gate those transitions
    // could consume the edge (so the real turn fires nothing) or fire it early.
    const isMyPlayTurn = (s: GameState) =>
      s.phase === 'gameplay' && s.currentPlayer !== null && s.currentPlayer === mySocketId;

    // Game start: transition into dealing phase (enough players voted)
    if (prev.phase !== 'dealing' && curr.phase === 'dealing') {
      // A new deal is a clean slate: players can re-ready long before a 46
      // second track has finished, and the last round's music must not follow
      // them into this one.
      sfx.stopMusic();
      sfx.play('gameStart');
    }

    // The music channel outlives the banner *and* the board, so that a big
    // finish can play out under the end-of-round screen while the server's
    // return_to_lobby resets everything underneath it. It ends here instead:
    // the moment nothing is entitled to it any more.
    if (holdsMusic(prev) && !holdsMusic(curr)) {
      sfx.stopMusic();
    }

    // Local player's turn ended (played or passed) — stop the yourTurn alert
    if (isMyPlayTurn(prev) && !isMyPlayTurn(curr)) {
      sfx.stop(yourTurnAudioRef.current);
      yourTurnAudioRef.current = null;
    }

    // Cards hitting the table. The tier sting and the big-play music are owned
    // by useHitEvents — this is only the card thwack that every play gets, with
    // a little pitch scatter so a long run of singles doesn't sound mechanical.
    if (curr.lastPlay !== prev.lastPlay && curr.lastPlay !== null) {
      sfx.play('cardPlay', { vary: 0.08 });
    }

    // Someone passed — check newest history entry
    const prevHistLen = prev.playHistory.length;
    const currHistLen = curr.playHistory.length;
    if (currHistLen > prevHistLen) {
      const latest = curr.playHistory[currHistLen - 1];
      if (latest?.play?.cards?.length === 0) {
        sfx.play('pass', { vary: 0.06 });
      }
    }

    // Your turn — play alert and keep a ref so we can stop it
    if (!isMyPlayTurn(prev) && isMyPlayTurn(curr)) {
      yourTurnAudioRef.current = sfx.play('yourTurn');
    }

    // Landlord decided
    if (curr.landlordIndex !== null && prev.landlordIndex === null) {
      sfx.play('landlord');
    }

    // Cards dealt
    if (prev.myHand.length === 0 && curr.myHand.length > 0 && curr.phase === 'dealing') {
      sfx.play('deal');
    }

    // 報單 / 報雙 — someone is down to their last card or two. Guarded on the
    // previous count being a real mid-game number so the initial deal (undefined
    // → 17) and a fresh round never trip it.
    if (curr.phase === 'gameplay') {
      curr.playerCardCounts.forEach((count, i) => {
        const before = prev.playerCardCounts[i];
        if (typeof before !== 'number' || before <= 2) return;
        if (count > 0 && count <= 2) sfx.play('warning');
      });
    }

    // Surrender toggle (any player): loop sound while at least one is pending, stop when none
    const anyWasSurrendered = prev.surrendered.length > 0;
    const anyIsSurrendered = curr.surrendered.length > 0;
    if (!anyWasSurrendered && anyIsSurrendered) {
      sfx.startLoop('surrenderPending');
    } else if (anyWasSurrendered && !anyIsSurrendered) {
      sfx.stopLoop('surrenderPending');
    }

    // Game over
    if (curr.winner !== null && prev.winner === null) {
      sfx.stopLoop('surrenderPending');
      sfx.stop(yourTurnAudioRef.current);
      yourTurnAudioRef.current = null;
      // A round that ended on a bomb or a comeback still has its music running,
      // and that track is the point of the end screen — don't stomp on it with
      // a win sting.
      if (!sfx.isMusicPlaying()) {
        const iAmLandlord = curr.playerOrder[curr.landlordIndex ?? -1] === mySocketId;
        const landlordWon = curr.winner === 'landlord';
        sfx.play(iAmLandlord === landlordWon ? 'win' : 'lose');
      }
    }

    prevStateRef.current = curr;
  }, [gameState, mySocketId]);

  // ── Turn-timer tick ────────────────────────────────────────────────────────
  // Driven off the server's endTime rather than a local countdown, so the ticks
  // stay aligned with the number the player is watching in CardHand.
  const isMyTurn =
    gameState.phase === 'gameplay' && gameState.currentPlayer === mySocketId;
  const endTime = gameState.currentPlayerEndTime;

  useEffect(() => {
    if (!isMyTurn || !endTime) return;
    let lastTicked = -1;
    const id = setInterval(() => {
      const remaining = Math.ceil((endTime - Date.now()) / 1000);
      if (remaining <= 0 || remaining > TICK_FROM_SECONDS) return;
      if (remaining === lastTicked) return;
      lastTicked = remaining;
      // Climb in pitch as the clock runs out.
      sfx.play('tick', { rate: 1 + (TICK_FROM_SECONDS - remaining) * 0.06 });
    }, 100);
    return () => clearInterval(id);
  }, [isMyTurn, endTime]);

  // Stop the surrender loop if the board unmounts mid-round (leave / navigate).
  useEffect(() => {
    return () => {
      sfx.stopLoop('surrenderPending');
      sfx.stop(yourTurnAudioRef.current);
    };
  }, []);

  const setVolume = (v: number) => sfx.setVolume(v);

  return { setVolume, playEmoji };
}
