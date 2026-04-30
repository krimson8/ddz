'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useGame } from '@/hooks/useGame';
import { useSocket } from '@/hooks/useSocket';
import { RoomLobby } from '@/components/RoomLobby';
import { GameBoard } from '@/components/GameBoard';

export default function RoomPage() {
  const params = useParams();
  const router = useRouter();
  const code = (params?.code as string)?.toUpperCase() ?? '';
  const socket = useSocket();

  const {
    gameState,
    joinRoom,
    votePlay,
    bid,
    playCards,
    pass,
    reactEmoji,
  } = useGame();

  const { phase, roomCode, confirmedVoters, members, winCounts } = gameState;

  const [myNickname, setMyNickname] = useState('');
  const [hasVoted, setHasVoted] = useState(false);
  const hasJoined = useRef(false);

  // Reconnect or join on mount
  useEffect(() => {
    const reconnectToken = sessionStorage.getItem('reconnectToken');
    const storedCode = sessionStorage.getItem('roomCode');
    console.log('[RoomPage] mount effect - reconnectToken:', reconnectToken, 'storedCode:', storedCode, 'code:', code, 'socket.connected:', socket.connected, 'socket.id:', socket.id);

    if (reconnectToken && storedCode === code) {
      console.log('[RoomPage] emitting rejoin event');
      socket.emit('rejoin', { code, reconnectToken });
    } else if (!hasJoined.current) {
      hasJoined.current = true;
      const nickname =
        localStorage.getItem('ddz_nickname') ??
        `玩家${Math.floor(Math.random() * 900) + 100}`;
      setMyNickname(nickname);
      joinRoom(code, nickname);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist reconnect token when server sends it
  useEffect(() => {
    const saveToken = (data: { roomCode: string; reconnectToken: string }) => {
      sessionStorage.setItem('reconnectToken', data.reconnectToken);
      sessionStorage.setItem('roomCode', data.roomCode);
    };
    const handleRoomError = (data: { message: string }) => {
      alert(data.message);
      router.push('/');
    };
    socket.on('room_joined', saveToken);
    socket.on('room_created', saveToken);
    // Server error → back to home
    socket.on('room_error', handleRoomError);
    return () => {
      socket.off('room_joined', saveToken);
      socket.off('room_created', saveToken);
      socket.off('room_error', handleRoomError);
    };
  }, [socket, router]);

  // Reset vote state when new round starts
  useEffect(() => {
    if (phase === 'lobby') setHasVoted(false);
  }, [phase]);

  function handleVote() {
    setHasVoted(true);
    votePlay();
  }

  // ── Render ───────────────────────────────────────────────────────────────

  // Lobby
  if (phase === 'lobby') {
    return (
      <div className="min-h-screen bg-green-900 flex flex-col items-center justify-center gap-6 py-10">
        <h1 className="text-3xl font-black text-white tracking-wide">🀄 鬥地主</h1>
        <RoomLobby
          roomCode={roomCode ?? code}
          members={members ?? []}
          confirmedVoters={confirmedVoters ?? []}
          myNickname={myNickname}
          onVote={handleVote}
          hasVoted={hasVoted}
          winCounts={winCounts}
        />
      </div>
    );
  }

  // Bidding / Gameplay — GameBoard handles both via phase prop
  return (
    <GameBoard
      gameState={gameState}
      mySocketId={socket.id ?? ''}
      onPlayCards={playCards}
      onPass={pass}
      onBid={bid}
      onEmojiReact={reactEmoji}
    />
  );
}
