'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import { useSocket } from '@/hooks/useSocket';
import { useEmojiChat } from '@/hooks/useEmojiChat';
import { useGame } from '@/features/ddz/useGame';
import { useSoundEffects } from '@/features/ddz/useSoundEffects';
import { RoomLobby } from '@/features/ddz/components/RoomLobby';
import { GameBoard } from '@/features/ddz/components/GameBoard';
import { EmojiChatBox } from '@/components/EmojiChatBox';
import { VolumeControl } from '@/components/VolumeControl';

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
  } = useGame();
  const { setVolume, playEmoji } = useSoundEffects(gameState, user?.uid ?? '');
  const { phase, roomCode, members, readyCount } = gameState;

  // Emoji chat lives at the page level so the subscription + history persist
  // across the waiting lobby → game transition (the channel is room-scoped, not
  // phase-scoped).
  const { history: emojiHistory, selectedReaction, setSelectedReaction, reactEmoji } = useEmojiChat('ddz', {
    onEmojiReceived: playEmoji,
  });

  const [error, setError] = useState('');

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
      <VolumeControl onVolumeChange={setVolume} />

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
        />
      )}
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
