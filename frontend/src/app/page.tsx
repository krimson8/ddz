'use client';

import { useEffect, useRef, useState } from 'react';
import { useGame } from '@/hooks/useGame';
import { useSocket } from '@/hooks/useSocket';
import { RoomLobby } from '@/components/RoomLobby';
import { GameBoard } from '@/components/GameBoard';

function sanitizeNickname(raw: string): string {
  return raw.replace(/<[^>]*>/g, '').trim().slice(0, 10);
}

function clearRoomStorage(roomCode: string) {
  localStorage.removeItem(`ddz_reconnectToken_${roomCode}`);
}

export default function Home() {
  const socket = useSocket();
  const { gameState, createRoom, joinRoom, leaveRoom, votePlay, bid, playCards, pass, reactEmoji } = useGame();
  const { phase, roomCode, members, winCounts, readyCount, canVote } = gameState;

  const [nickname, setNickname] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const hasAttemptedReconnect = useRef(false);

  // Pre-fill nickname from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('ddz_nickname');
    if (saved) setNickname(saved);
  }, []);

  // On mount: attempt reconnect if a token exists from a previous session
  useEffect(() => {
    if (hasAttemptedReconnect.current) return;
    hasAttemptedReconnect.current = true;

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('ddz_reconnectToken_')) {
        const code = key.replace('ddz_reconnectToken_', '');
        const token = localStorage.getItem(key);
        if (token) {
          socket.emit('rejoin', { code, reconnectToken: token });
          return;
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On socket transport reconnect: re-emit rejoin if we're in a room
  useEffect(() => {
    function handleConnect() {
      if (!roomCode) return;
      const token = localStorage.getItem(`ddz_reconnectToken_${roomCode}`);
      if (token) socket.emit('rejoin', { code: roomCode, reconnectToken: token });
    }
    socket.on('connect', handleConnect);
    return () => { socket.off('connect', handleConnect); };
  }, [socket, roomCode]);

  // Save reconnect token whenever server sends it
  useEffect(() => {
    const save = (data: { roomCode: string; reconnectToken: string }) => {
      if (data.reconnectToken) {
        localStorage.setItem(`ddz_reconnectToken_${data.roomCode}`, data.reconnectToken);
      }
    };
    socket.on('room_created', save);
    socket.on('room_joined', save);
    return () => {
      socket.off('room_created', save);
      socket.off('room_joined', save);
    };
  }, [socket]);

  // room_disbanded: server confirms the room is gone — clear token (state reset already handled by useGame via game_aborted)
  useEffect(() => {
    const handleDisbanded = () => {
      if (roomCode) clearRoomStorage(roomCode);
    };
    socket.on('room_disbanded', handleDisbanded);
    return () => { socket.off('room_disbanded', handleDisbanded); };
  }, [socket, roomCode]);

  // Listen for server errors
  useEffect(() => {
    const handleError = (data: { message: string }) => {
      if (roomCode) clearRoomStorage(roomCode);
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith('ddz_reconnectToken_')) {
          localStorage.removeItem(key);
          break;
        }
      }
      setError(data.message);
    };
    socket.on('room_error', handleError);
    return () => { socket.off('room_error', handleError); };
  }, [socket, roomCode]);

  function handleCreate() {
    const clean = sanitizeNickname(nickname);
    if (clean.length < 2) { setError('暱稱至少需要 2 個字元'); return; }
    localStorage.setItem('ddz_nickname', clean);
    setError('');
    createRoom(clean);
  }

  function handleJoin() {
    const clean = sanitizeNickname(nickname);
    if (clean.length < 2) { setError('暱稱至少需要 2 個字元'); return; }
    if (!joinCode.trim()) { setError('請輸入房間代碼'); return; }
    localStorage.setItem('ddz_nickname', clean);
    setError('');
    joinRoom(joinCode.trim().toUpperCase(), clean);
  }

  function handleLeaveRoom() {
    // Clear the token immediately so a page refresh after leaving returns to home.
    // State reset waits for server confirmation (members_update / game_aborted).
    if (roomCode) clearRoomStorage(roomCode);
    leaveRoom();
  }

  const hasVoted = members.some((m) => m.id === socket.id && m.wantToPlay);

  // ── Home screen ───────────────────────────────────────────────────────────
  if (phase === 'lobby' && !roomCode) {
    return (
      <div className="min-h-screen bg-green-900 flex items-center justify-center p-4">
        <div className="bg-white/10 backdrop-blur rounded-2xl p-8 w-full max-w-sm flex flex-col gap-6">
          <h1 className="text-4xl font-bold text-white text-center tracking-wide">🀄 鬥地主</h1>

          <div className="flex flex-col gap-1">
            <label className="text-white/80 text-sm">暱稱</label>
            <input
              className="rounded-lg px-4 py-3 text-lg bg-white/20 text-white placeholder-white/40 outline-none focus:ring-2 focus:ring-yellow-400"
              placeholder="你的暱稱（2–10字）"
              maxLength={10}
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            />
          </div>

          <button
            onClick={handleCreate}
            className="rounded-xl py-3 text-lg font-bold bg-yellow-400 hover:bg-yellow-300 active:bg-yellow-500 text-green-900 transition-colors"
          >
            建立房間
          </button>

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-white/20" />
            <span className="text-white/50 text-sm">或</span>
            <div className="flex-1 h-px bg-white/20" />
          </div>

          <div className="flex flex-col gap-3">
            <label className="text-white/80 text-sm">加入房間</label>
            <input
              className="rounded-lg px-4 py-3 text-lg bg-white/20 text-white placeholder-white/40 outline-none focus:ring-2 focus:ring-yellow-400 uppercase tracking-widest"
              placeholder="房間代碼"
              maxLength={6}
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
            />
            <button
              onClick={handleJoin}
              className="rounded-xl py-3 text-lg font-bold bg-white/20 hover:bg-white/30 active:bg-white/10 text-white transition-colors"
            >
              加入
            </button>
          </div>

          {error && <p className="text-red-300 text-sm text-center">{error}</p>}
        </div>
      </div>
    );
  }

  // ── Lobby ─────────────────────────────────────────────────────────────────
  if (phase === 'lobby' && roomCode) {
    return (
      <div className="min-h-screen bg-green-900 flex flex-col items-center justify-center gap-6 py-10">
        <button
          onClick={handleLeaveRoom}
          className="self-start ml-4 text-white/60 hover:text-white text-sm flex items-center gap-1 transition-colors"
        >
          ← 離開房間
        </button>
        <h1 className="text-3xl font-black text-white tracking-wide">🀄 鬥地主</h1>
        <RoomLobby
          roomCode={roomCode}
          members={members}
          myNickname={nickname || (localStorage.getItem('ddz_nickname') ?? '')}
          onVote={votePlay}
          hasVoted={hasVoted}
          winCounts={winCounts}
          readyCount={readyCount}
          canVote={canVote}
        />
      </div>
    );
  }

  // ── Game board (dealing / bidding / gameplay / result) ────────────────────
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
