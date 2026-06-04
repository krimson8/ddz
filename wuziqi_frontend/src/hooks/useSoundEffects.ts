'use client';

import { useEffect, useRef } from 'react';
import type { GameState } from '@/types/game';

// Pruned for 五子棋 (SPEC_WUZIQI §10a): no deal/landlord/pass. Stone placement
// reuses card-play.wav. win/lose point at files that may not exist — the player
// catches load/play errors and skips silently, so that's harmless.
const SOUNDS: Record<string, string> = {
  gameStart: '/sounds/game-ready.mp3',
  yourTurn: '/sounds/your-turn.mp3',
  stonePlace: '/sounds/card-play.wav',
  win: '/sounds/win.mp3', // optional — silently skipped if missing
  lose: '/sounds/lose.mp3', // optional — silently skipped if missing
};

// The 15 reaction texts. MUST stay in sync with the backend ALLOWED_REACTIONS
// set in game.gateway.ts. Some files don't exist and fail silently.
const EMOJI_SOUNDS: Record<string, string> = {
  '🖕': '/sounds/emoji/middle-finger.mp3',
  '🤏': '/sounds/emoji/small.mp3',
  '🤌': '/sounds/emoji/chef-kiss.mp3',
  '我操': '/sounds/emoji/wo-cao.mp3',
  'EZ': '/sounds/emoji/ez.mp3',
  'GG': '/sounds/emoji/gg.mp3',
  '玩不了啦': '/sounds/emoji/wan-bu-liao-la.mp3',
  '小兒科': '/sounds/emoji/xiao-er-ke.ogg',
  '你會玩的嗎': '/sounds/emoji/ni-hui-wan-de-ma.mp3',
  '小癟三': '/sounds/emoji/xiao-bie-san1.ogg',
  '不用看了': '/sounds/emoji/bu-yong-kan-le.ogg',
  '窩妖驗牌': '/sounds/emoji/wo-yao-yan-pai.ogg',
  '牌沒有問題': '/sounds/emoji/pai-mei-you-wen-ti.ogg',
  '在我者離': '/sounds/emoji/zai-wo-zhe-li.ogg',
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
    const v = parseFloat(localStorage.getItem('wuziqi_volume') ?? '1');
    return isNaN(v) ? 1 : Math.max(0, Math.min(1, v));
  } catch {
    return 1;
  }
}

/** `mySocketId` here is the local user's uid (matches GameState colour owners). */
export function useSoundEffects(gameState: GameState, myUid: string) {
  const poolsRef = useRef<Record<string, HTMLAudioElement[]>>({});
  const poolIndexRef = useRef<Record<string, number>>({});
  const emojiPoolsRef = useRef<Record<string, HTMLAudioElement>>({});
  const prevStateRef = useRef<GameState>(gameState);
  const volumeRef = useRef<number>(1);
  const yourTurnAudioRef = useRef<HTMLAudioElement | null>(null);

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
    if (!audio) return; // no sound mapped — skip silently
    audio.volume = volumeRef.current;
    audio.currentTime = 0;
    audio.play().catch(() => {}); // missing file / autoplay block — skip silently
  };

  useEffect(() => {
    const prev = prevStateRef.current;
    const curr = gameState;

    const myTurn = (s: GameState) =>
      s.phase === 'gameplay' && s.myColor !== null && s.myColor === s.currentColor;

    // Game start
    if (prev.phase !== 'gameplay' && curr.phase === 'gameplay') {
      play('gameStart');
    }

    // A stone was placed (move count grew)
    if (curr.moves.length > prev.moves.length) {
      play('stonePlace');
    }

    // My turn just began
    if (!myTurn(prev) && myTurn(curr)) {
      yourTurnAudioRef.current = play('yourTurn') ?? null;
    }
    // My turn ended
    if (myTurn(prev) && !myTurn(curr)) {
      stopYourTurn();
    }

    // Game over
    if (curr.winnerColor !== null && prev.winnerColor === null) {
      stopYourTurn();
      if (curr.winnerColor === 'draw' || curr.myColor === null) {
        // spectator or draw — no win/lose cue
      } else {
        play(curr.winnerColor === curr.myColor ? 'win' : 'lose');
      }
    }

    prevStateRef.current = curr;
  }, [gameState, myUid]);

  const setVolume = (v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    volumeRef.current = clamped;
    for (const pool of Object.values(poolsRef.current)) {
      for (const audio of pool) audio.volume = clamped;
    }
    for (const audio of Object.values(emojiPoolsRef.current)) {
      audio.volume = clamped;
    }
    try {
      localStorage.setItem('wuziqi_volume', String(clamped));
    } catch {
      /* ignore */
    }
  };

  return { setVolume, playEmoji };
}
