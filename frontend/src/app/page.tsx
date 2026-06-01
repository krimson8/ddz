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
  const { gameState, createRoom, joinRoom, leaveRoom, votePlay, bid, coinVote, playCards, pass, surrender, reactEmoji } = useGame();
  const { setVolume, playEmoji } = useSoundEffects(gameState, user?.uid ?? '');
  const { phase, roomCode, members, readyCount } = gameState;

  const [error, setError] = useState('');

  // Listen for server errors
  useEffect(() => {
    const handleError = (data: { message: string }) => setError(data.message);
    socket.on('room_error', handleError);
    return () => { socket.off('room_error', handleError); };
  }, [socket]);

  // Auto-clear errors after a few seconds
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(''), 4_000);
    return () => clearTimeout(t);
  }, [error]);

  // Redirect to login if not signed in
  useEffect(() => {
    if (!authLoading && !user) router.replace('/login');
  }, [authLoading, user, router]);

  // Subscribe to lobby room list whenever we're not in a room.
  const showLobby = phase === 'lobby' && !roomCode;
  const rooms = useRoomList(socket, showLobby && !!user);

  // ── Render gates ────────────────────────────────────────────────────────

  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-green-900 text-white flex items-center justify-center">
        Loading...
      </div>
    );
  }

  const myNickname = me?.nickname ?? user.email?.split('@')[0] ?? '玩家';
  const hasVoted = members.some((m) => m.id === user.uid && m.wantToPlay);

  return (
    <>
      <VolumeControl onVolumeChange={setVolume} />

      {error && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-red-600 text-white px-4 py-2 rounded-lg shadow-lg text-sm">
          {error}
        </div>
      )}

      {/* ── Global lobby (room list + create) ─────────────────────────── */}
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

      {/* ── In-room lobby (vote to play) ──────────────────────────────── */}
      {phase === 'lobby' && roomCode && (
        <div className="min-h-screen bg-green-900 flex flex-col items-center justify-center gap-6 py-10">
          <button
            onClick={leaveRoom}
            className="fixed top-3 left-3 z-50 text-white/70 hover:text-white text-sm flex items-center gap-1 transition-colors bg-black/40 backdrop-blur-sm rounded-full px-3 py-1.5"
          >
            ← 離開房間
          </button>
          <h1 className="text-3xl font-black text-white tracking-wide">🀄 鬥地主</h1>
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

      {/* ── Game board ────────────────────────────────────────────────── */}
      {phase !== 'lobby' && (
        <GameBoard
          gameState={gameState}
          mySocketId={user.uid}
          onPlayCards={playCards}
          onPass={pass}
          onBid={bid}
          onCoinVote={coinVote}
          onSurrender={surrender}
          onEmojiReact={reactEmoji}
          onEmojiReceived={playEmoji}
        />
      )}
    </>
  );
}
