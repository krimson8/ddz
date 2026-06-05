'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import { useSocket } from '@/hooks/useSocket';
import { useGame } from '@/features/wuziqi/useGame';
import { useSoundEffects } from '@/features/wuziqi/useSoundEffects';
import { RoomLobby } from '@/features/wuziqi/components/RoomLobby';
import { GameBoard } from '@/features/wuziqi/components/GameBoard';
import { VolumeControl } from '@/components/VolumeControl';

function WuziqiPlayInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const { me } = useProfile();
  const socket = useSocket('wuziqi');
  const {
    gameState,
    createRoom,
    joinRoom,
    leaveRoom,
    votePlay,
    placeStone,
    resign,
    voteDraw,
    reactEmoji,
  } = useGame();
  const { setVolume, playEmoji } = useSoundEffects(gameState, user?.uid ?? '');
  const { phase, roomCode, members } = gameState;

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
    const handleInvalid = (data: { reason: string }) => setError(data.reason);
    socket.on('room_error', handleError);
    socket.on('invalid_move', handleInvalid);
    return () => {
      socket.off('room_error', handleError);
      socket.off('invalid_move', handleInvalid);
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
  const hasVoted = members.some((m) => m.uid === user.uid && m.wantToPlay);

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

      {/* In-room lobby (vote to play) */}
      {phase === 'lobby' && (
        <div className="min-h-screen bg-green-900 flex flex-col items-center justify-center gap-6 py-10">
          <button
            onClick={backToLobby}
            className="fixed top-3 left-3 z-50 text-white/70 hover:text-white text-sm flex items-center gap-1 transition-colors bg-black/40 backdrop-blur-sm rounded-full px-3 py-1.5"
          >
            ← 離開房間
          </button>
          <h1 className="text-3xl font-black text-white tracking-wide">⚫ 五子棋</h1>
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
        </div>
      )}

      {/* Game board (starting / gameplay / result) */}
      {phase !== 'lobby' && (
        <GameBoard
          gameState={gameState}
          myUid={user.uid}
          onPlaceStone={placeStone}
          onResign={resign}
          onDrawVote={voteDraw}
          onEmojiReact={reactEmoji}
          onEmojiReceived={playEmoji}
          onLeave={backToLobby}
        />
      )}
    </>
  );
}

export default function WuziqiPlay() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-green-900 text-white flex items-center justify-center">
          Loading...
        </div>
      }
    >
      <WuziqiPlayInner />
    </Suspense>
  );
}
