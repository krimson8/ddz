'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import { useGame } from '@/hooks/useGame';
import { useSocket } from '@/hooks/useSocket';
import { useSoundEffects } from '@/hooks/useSoundEffects';
import { useRoomList } from '@/hooks/useRoomList';
import { LobbyRoomList } from '@/components/LobbyRoomList';
import { RoomLobby } from '@/components/RoomLobby';
import { GameBoard } from '@/components/GameBoard';
import { VolumeControl } from '@/components/VolumeControl';

export default function Home() {
  const router = useRouter();
  const { user, loading: authLoading, signOut } = useAuth();
  const { me } = useProfile();
  const socket = useSocket();
  const { gameState, createRoom, joinRoom, leaveRoom, votePlay, placeStone, resign, voteDraw, reactEmoji } = useGame();
  const { setVolume, playEmoji } = useSoundEffects(gameState, user?.uid ?? '');
  const { phase, roomCode, members } = gameState;

  const [error, setError] = useState('');

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

  const showLobby = phase === 'lobby' && !roomCode;
  const rooms = useRoomList(socket, showLobby && !!user);

  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-green-900 text-white flex items-center justify-center">
        Loading...
      </div>
    );
  }

  const myNickname = me?.nickname ?? user.email?.split('@')[0] ?? '玩家';
  const hasVoted = members.some((m) => m.uid === user.uid && m.wantToPlay);

  return (
    <>
      <VolumeControl onVolumeChange={setVolume} />

      {error && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-red-600 text-white px-4 py-2 rounded-lg shadow-lg text-sm">
          {error}
        </div>
      )}

      {/* Global lobby */}
      {showLobby && (
        <LobbyRoomList
          rooms={rooms}
          onCreateRoom={createRoom}
          onJoinRoom={joinRoom}
          myNickname={myNickname}
          alreadyInRoom={rooms.some((r) => r.myMembership !== 'none')}
          onSignOut={signOut}
        />
      )}

      {/* In-room lobby (vote to play) */}
      {phase === 'lobby' && roomCode && (
        <div className="min-h-screen bg-green-900 flex flex-col items-center justify-center gap-6 py-10">
          <button
            onClick={leaveRoom}
            className="fixed top-3 left-3 z-50 text-white/70 hover:text-white text-sm flex items-center gap-1 transition-colors bg-black/40 backdrop-blur-sm rounded-full px-3 py-1.5"
          >
            ← 離開房間
          </button>
          <h1 className="text-3xl font-black text-white tracking-wide">⚫ 五子棋</h1>
          <RoomLobby
            roomCode={roomCode}
            members={members}
            myNickname={myNickname}
            myUid={user.uid}
            onVote={votePlay}
            hasVoted={hasVoted}
          />
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
          onLeave={leaveRoom}
        />
      )}
    </>
  );
}
