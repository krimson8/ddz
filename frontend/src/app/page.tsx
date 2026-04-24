'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useGame } from '@/hooks/useGame';
import { useSocket } from '@/hooks/useSocket';

function sanitizeNickname(raw: string): string {
  return raw.replace(/<[^>]*>/g, '').trim().slice(0, 10);
}

export default function Home() {
  const router = useRouter();
  const socket = useSocket();
  const { createRoom, joinRoom, gameState } = useGame();

  const [nickname, setNickname] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [error, setError] = useState('');
  const pendingAction = useRef<'create' | 'join' | null>(null);

  // Pre-fill nickname from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('ddz_nickname');
    if (saved) setNickname(saved);
  }, []);

  // Navigate once room is confirmed
  useEffect(() => {
    console.log("[page] roomCode changed:", gameState.roomCode, "pendingAction:", pendingAction.current);
    if (pendingAction.current && gameState.roomCode) {
      pendingAction.current = null;
      router.push(`/room/${gameState.roomCode}`);
    }
  }, [gameState.roomCode, router]);

  // Persist reconnect token so the room page can use the reconnect path
  // instead of calling join_room again on the creator's behalf.
  useEffect(() => {
    const save = (data: { roomCode: string; reconnectToken: string }) => {
      sessionStorage.setItem('reconnectToken', data.reconnectToken);
      sessionStorage.setItem('roomCode', data.roomCode);
    };
    socket.on('room_created', save);
    socket.on('room_joined', save);
    return () => {
      socket.off('room_created', save);
      socket.off('room_joined', save);
    };
  }, [socket]);

  // Listen for server errors
  useEffect(() => {
    socket.on('room_error', (data: { message: string }) => setError(data.message));
    return () => { socket.off('room_error'); };
  }, [socket]);

  function handleCreate() {
    const clean = sanitizeNickname(nickname);
    if (clean.length < 2) { setError('暱稱至少需要 2 個字元'); return; }
    localStorage.setItem('ddz_nickname', clean);
    setError('');
    pendingAction.current = 'create';
    createRoom(clean);
  }

  function handleJoin() {
    const clean = sanitizeNickname(nickname);
    if (clean.length < 2) { setError('暱稱至少需要 2 個字元'); return; }
    if (!roomCode.trim()) { setError('請輸入房間代碼'); return; }
    localStorage.setItem('ddz_nickname', clean);
    setError('');
    console.log("[page] handleJoin called, code:", roomCode.trim().toUpperCase(), "nickname:", clean);
    pendingAction.current = 'join';
    joinRoom(roomCode.trim().toUpperCase(), clean);
  }

  return (
    <div className="min-h-screen bg-green-900 flex items-center justify-center p-4">
      <div className="bg-white/10 backdrop-blur rounded-2xl p-8 w-full max-w-sm flex flex-col gap-6">
        <h1 className="text-4xl font-bold text-white text-center tracking-wide">🀄 鬥地主</h1>

        {/* Nickname */}
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

        {/* Create Room */}
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

        {/* Join Room */}
        <div className="flex flex-col gap-3">
          <label className="text-white/80 text-sm">加入房間</label>
          <input
            className="rounded-lg px-4 py-3 text-lg bg-white/20 text-white placeholder-white/40 outline-none focus:ring-2 focus:ring-yellow-400 uppercase tracking-widest"
            placeholder="房間代碼"
            maxLength={6}
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
          />
          <button
            onClick={handleJoin}
            className="rounded-xl py-3 text-lg font-bold bg-white/20 hover:bg-white/30 active:bg-white/10 text-white transition-colors"
          >
            加入
          </button>
        </div>

        {error && (
          <p className="text-red-300 text-sm text-center">{error}</p>
        )}
      </div>
    </div>
  );
}
