'use client';

import { useEffect, useRef } from 'react';
import type { GameState } from '@/types/game';

const SOUNDS: Record<string, string> = {
  cardPlay: '/sounds/card-play.wav',
  pass: '/sounds/pass.mp3',
  yourTurn: '/sounds/your-turn.mp3',
  deal: '/sounds/deal.mp3',
  win: '/sounds/win.mp3',
  lose: '/sounds/lose.mp3',
  landlord: '/sounds/landlord.mp3',
  gameStart: '/sounds/game-ready.mp3',
  // Loops while the local player has toggled surrender on (before confirm).
  // Rename this file as needed — just update the path here.
  surrenderPending: '/sounds/surrender.mp3',
};

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

function createAudioPool(src: string, size = 3): HTMLAudioElement[] {
  return Array.from({ length: size }, () => {
    const a = new Audio(src);
    a.preload = 'auto';
    return a;
  });
}

function loadVolume(): number {
  try {
    const v = parseFloat(localStorage.getItem('ddz_volume') ?? '1');
    return isNaN(v) ? 1 : Math.max(0, Math.min(1, v));
  } catch {
    return 1;
  }
}

export function useSoundEffects(gameState: GameState, mySocketId: string) {
  const poolsRef = useRef<Record<string, HTMLAudioElement[]>>({});
  const poolIndexRef = useRef<Record<string, number>>({});
  const emojiPoolsRef = useRef<Record<string, HTMLAudioElement>>({});
  const prevStateRef = useRef<GameState>(gameState);
  const volumeRef = useRef<number>(1);
  const yourTurnAudioRef = useRef<HTMLAudioElement | null>(null);
  const surrenderLoopRef = useRef<HTMLAudioElement | null>(null);

  // Hydrate volume from localStorage once on mount
  useEffect(() => {
    volumeRef.current = loadVolume();
  }, []);

  const ensurePools = () => {
    if (Object.keys(poolsRef.current).length > 0) return;
    for (const [key, src] of Object.entries(SOUNDS)) {
      poolsRef.current[key] = createAudioPool(src);
      poolIndexRef.current[key] = 0;
    }
    for (const [emoji, src] of Object.entries(EMOJI_SOUNDS)) {
      const a = new Audio(src);
      a.preload = 'auto';
      emojiPoolsRef.current[emoji] = a;
    }
  };

  const play = (key: string) => {
    if (volumeRef.current === 0) return;
    ensurePools();
    const pool = poolsRef.current[key];
    if (!pool?.length) return;
    const idx = poolIndexRef.current[key] ?? 0;
    const audio = pool[idx % pool.length];
    poolIndexRef.current[key] = idx + 1;
    audio.volume = volumeRef.current;
    audio.currentTime = 0;
    audio.play().catch(() => {});
    return audio;
  };

  const startSurrenderLoop = () => {
    if (volumeRef.current === 0) return;
    if (surrenderLoopRef.current && !surrenderLoopRef.current.paused) return;
    ensurePools();
    const pool = poolsRef.current['surrenderPending'];
    if (!pool?.length) return;
    const audio = pool[0];
    audio.loop = true;
    audio.volume = volumeRef.current;
    audio.currentTime = 0;
    audio.play().catch(() => {});
    surrenderLoopRef.current = audio;
  };

  const stopSurrenderLoop = () => {
    const a = surrenderLoopRef.current;
    if (a) {
      a.pause();
      a.currentTime = 0;
      a.loop = false;
    }
    surrenderLoopRef.current = null;
  };

  const stopYourTurn = () => {
    const a = yourTurnAudioRef.current;
    if (a && !a.paused) {
      a.pause();
      a.currentTime = 0;
    }
    yourTurnAudioRef.current = null;
  };

  const playEmoji = (emoji: string) => {
    if (volumeRef.current === 0) return;
    ensurePools();
    const audio = emojiPoolsRef.current[emoji];
    if (!audio) return; // no sound mapped for this emoji — skip silently
    audio.volume = volumeRef.current;
    audio.currentTime = 0;
    audio.play().catch(() => {}); // missing file or autoplay block — skip silently
  };

  useEffect(() => {
    const prev = prevStateRef.current;
    const curr = gameState;

    // Game start: transition into dealing phase (enough players voted)
    if (prev.phase !== 'dealing' && curr.phase === 'dealing') {
      play('gameStart');
    }

    // Local player's turn ended (played or passed) — stop the yourTurn alert
    if (prev.currentPlayer === mySocketId && curr.currentPlayer !== mySocketId) {
      stopYourTurn();
    }

    // Cards played
    if (curr.lastPlay !== prev.lastPlay && curr.lastPlay !== null) {
      play('cardPlay');
    }

    // Someone passed — check newest history entry
    const prevHistLen = prev.playHistory.length;
    const currHistLen = curr.playHistory.length;
    if (currHistLen > prevHistLen) {
      const latest = curr.playHistory[currHistLen - 1];
      if (latest?.play?.cards?.length === 0) {
        play('pass');
      }
    }

    // Your turn — play alert and keep a ref so we can stop it
    if (curr.currentPlayer !== prev.currentPlayer && curr.currentPlayer === mySocketId) {
      yourTurnAudioRef.current = play('yourTurn') ?? null;
    }

    // Landlord decided
    if (curr.landlordIndex !== null && prev.landlordIndex === null) {
      play('landlord');
    }

    // Cards dealt
    if (prev.myHand.length === 0 && curr.myHand.length > 0 && curr.phase === 'dealing') {
      play('deal');
    }

    // Surrender toggle (any player): loop sound while at least one is pending, stop when none
    const anyWasSurrendered = prev.surrendered.length > 0;
    const anyIsSurrendered = curr.surrendered.length > 0;
    if (!anyWasSurrendered && anyIsSurrendered) {
      startSurrenderLoop();
    } else if (anyWasSurrendered && !anyIsSurrendered) {
      stopSurrenderLoop();
    }

    // Game over
    if (curr.winner !== null && prev.winner === null) {
      stopSurrenderLoop();
      stopYourTurn();
      const iAmLandlord = curr.playerOrder[curr.landlordIndex ?? -1] === mySocketId;
      const landlordWon = curr.winner === 'landlord';
      play(iAmLandlord === landlordWon ? 'win' : 'lose');
    }

    prevStateRef.current = curr;
  }, [gameState, mySocketId]);

  const setVolume = (v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    volumeRef.current = clamped;
    // Apply immediately to all live audio elements
    for (const pool of Object.values(poolsRef.current)) {
      for (const audio of pool) audio.volume = clamped;
    }
    for (const audio of Object.values(emojiPoolsRef.current)) {
      audio.volume = clamped;
    }
    try { localStorage.setItem('ddz_volume', String(clamped)); } catch { /* ignore */ }
  };

  return { setVolume, playEmoji };
}
