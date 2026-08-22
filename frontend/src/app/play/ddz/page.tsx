'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import { useSocket } from '@/hooks/useSocket';
import { useEmojiChat } from '@/hooks/useEmojiChat';
import { useVolume } from '@/hooks/useVolume';
import { useGame } from '@/features/ddz/useGame';
import { useSoundEffects } from '@/features/ddz/useSoundEffects';
import {
  loadCardScale,
  setCardScale,
  CARD_SCALE_MIN,
  CARD_SCALE_MAX,
} from '@/features/ddz/cardScale';
import { RoomLobby } from '@/features/ddz/components/RoomLobby';
import { GameBoard } from '@/features/ddz/components/GameBoard';
import { RoundOverScreen } from '@/features/ddz/components/RoundOverScreen';
import { EmojiChatBox } from '@/components/EmojiChatBox';
import { SettingsMenu, type SliderSetting } from '@/components/SettingsMenu';

const REACTION_GROUPS = [
  { label: '表情', items: ['🖕', '🤏', '🤌'] },
  { label: '語錄', items: ['EZ', 'GG', '你會玩的嗎', '玩不了啦', '小兒科', '小癟三', '不用看了', '在我者離', '窩妖驗牌', '牌沒有問題', '給我搽皮鞋'] },
];

function DdzPlayInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const { me } = useProfile();
  const socket = useSocket('ddz');
  const {
    gameState,
    createRoom,
    joinRoom,
    leaveRoom,
    votePlay,
    bid,
    pickRole,
    revealRoleForFun,
    playCards,
    pass,
    surrender,
    dismissResult,
  } = useGame();
  const { setVolume: applyVolume, playEmoji } = useSoundEffects(gameState, user?.uid ?? '');
  const { volume, setVolume } = useVolume(applyVolume, 'ddz_volume');
  const { phase, roomCode, members, readyCount } = gameState;

  // Emoji chat lives at the page level so the subscription + history persist
  // across the waiting lobby → game transition (the channel is room-scoped, not
  // phase-scoped).
  const { history: emojiHistory, selectedReaction, setSelectedReaction, reactEmoji } = useEmojiChat('ddz', {
    onEmojiReceived: playEmoji,
  });

  // Played-card size — only adjustable during an actual game (not the lobby).
  const [cardScale, setCardScaleState] = useState(1);
  useEffect(() => {
    setCardScaleState(loadCardScale());
  }, []);
  const handleCardScale = (v: number) => {
    setCardScaleState(v);
    setCardScale(v); // persist + broadcast to PlayArea
  };
  const extraSettings: SliderSetting[] =
    phase !== 'lobby'
      ? [
          {
            id: 'card-scale',
            label: '出牌卡片大小',
            value: cardScale,
            min: CARD_SCALE_MIN,
            max: CARD_SCALE_MAX,
            step: 0.05,
            onChange: handleCardScale,
            format: (v) => `${Math.round(v * 100)}%`,
          },
        ]
      : [];

  const [error, setError] = useState('');

  // ── End-of-round screen ─────────────────────────────────────────────────
  // The reducer snapshots the result at game over and carries it through the
  // server's return_to_lobby, so the screen can stay up until the player is
  // done — long enough for a 40-second track to finish. Showing it only in
  // lobby/result phases means a new round starting takes over automatically.
  const showResult =
    gameState.lastResult && (phase === 'lobby' || phase === 'result')
      ? gameState.lastResult
      : null;

  // Perform the create/join intent passed from the unified lobby exactly once.
  const actedRef = useRef(false);
  useEffect(() => {
    if (actedRef.current || !user) return;
    if (!socket.connected) return;
    const code = params.get('code');
    const create = params.get('create');
    if (create) {
      actedRef.current = true;
      createRoom();
    } else if (code) {
      actedRef.current = true;
      joinRoom(code);
    }
  }, [user, socket, socket.connected, params, createRoom, joinRoom]);

  useEffect(() => {
    const handleError = (data: { message: string }) => setError(data.message);
    socket.on('room_error', handleError);
    return () => {
      socket.off('room_error', handleError);
    };
  }, [socket]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(''), 4_000);
    return () => clearTimeout(t);
  }, [error]);

  useEffect(() => {
    if (!authLoading && !user) router.replace('/login');
  }, [authLoading, user, router]);

  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-green-900 text-white flex items-center justify-center">
        Loading...
      </div>
    );
  }

  const myNickname = me?.nickname ?? user.email?.split('@')[0] ?? '玩家';
  const hasVoted = members.some((m) => m.id === user.uid && m.wantToPlay);

  // Leave the room and return to the unified lobby.
  const backToLobby = () => {
    leaveRoom();
    router.push('/');
  };

  return (
    <>
      <SettingsMenu volume={volume} onVolumeChange={setVolume} extraSettings={extraSettings} />

      {error && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-red-600 text-white px-4 py-2 rounded-lg shadow-lg text-sm">
          {error}
        </div>
      )}

      {/* In-room lobby (vote to play) — also covers the brief pre-join state. */}
      {phase === 'lobby' && (
        <div className="min-h-screen bg-green-900 flex flex-col items-center justify-center gap-6 py-10">
          <button
            onClick={backToLobby}
            className="fixed top-3 left-3 z-50 text-white/70 hover:text-white text-sm flex items-center gap-1 transition-colors bg-black/40 backdrop-blur-sm rounded-full px-3 py-1.5"
          >
            ← 離開房間
          </button>
          <h1 className="text-3xl font-black text-white tracking-wide">🀄 鬥地主</h1>
          {roomCode ? (
            <RoomLobby
              roomCode={roomCode}
              members={members}
              myNickname={myNickname}
              myUid={user.uid}
              onVote={votePlay}
              hasVoted={hasVoted}
            />
          ) : (
            <p className="text-white/70">連線中…</p>
          )}
          {/* Emoji chat is available while waiting too */}
          <EmojiChatBox
            className="fixed bottom-3 right-3 z-50"
            history={emojiHistory}
            groups={REACTION_GROUPS}
            selected={selectedReaction}
            onSelect={setSelectedReaction}
            onSend={() => reactEmoji(selectedReaction)}
          />
        </div>
      )}

      {/* Game board */}
      {phase !== 'lobby' && (
        <GameBoard
          gameState={gameState}
          mySocketId={user.uid}
          onPlayCards={playCards}
          onPass={pass}
          onBid={bid}
          onPickRole={pickRole}
          onRevealRoleForFun={revealRoleForFun}
          onSurrender={surrender}
          onReactEmoji={reactEmoji}
          emojiHistory={emojiHistory}
          selectedReaction={selectedReaction}
          onSelectReaction={setSelectedReaction}
          onLeave={backToLobby}
        />
      )}

      {/* Sits above both the board and the in-room lobby, so it survives the
          server's return_to_lobby without blocking it. */}
      <RoundOverScreen result={showResult} myId={user.uid} onDismiss={dismissResult} />
    </>
  );
}

export default function DdzPlay() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-green-900 text-white flex items-center justify-center">
          Loading...
        </div>
      }
    >
      <DdzPlayInner />
    </Suspense>
  );
}
