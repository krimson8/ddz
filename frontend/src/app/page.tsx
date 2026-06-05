'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import { useSocket } from '@/hooks/useSocket';
import { useUnifiedRoomList } from '@/hooks/useUnifiedRoomList';
import { LobbyRoomList } from '@/components/LobbyRoomList';
import { GAME_META } from '@/lib/games';
import type { Game } from '@/lib/socket';

/**
 * Home = the unified lobby. It lists rooms from BOTH game backends at once and
 * lets the user create or join a room of either game. Picking a room navigates
 * to that game's play route (/play/ddz | /play/wuziqi), which performs the
 * actual create/join socket emit.
 */
export default function Home() {
  const router = useRouter();
  const { user, loading: authLoading, signOut } = useAuth();
  const { me } = useProfile();
  // Touch the DDZ socket so it's connected for the lobby (wuziqi is connected
  // inside useUnifiedRoomList). Both feed the merged room list.
  useSocket('ddz');

  const [error, setError] = useState('');

  const rooms = useUnifiedRoomList(!!user);

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
  const alreadyInRoom = rooms.some((r) => r.myMembership !== 'none');

  const goCreate = (game: Game) => router.push(`${GAME_META[game].route}?create=1`);
  const goJoin = (game: Game, code: string) =>
    router.push(`${GAME_META[game].route}?code=${encodeURIComponent(code)}`);

  return (
    <>
      {error && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-red-600 text-white px-4 py-2 rounded-lg shadow-lg text-sm">
          {error}
        </div>
      )}

      <LobbyRoomList
        rooms={rooms}
        onCreateRoom={goCreate}
        onJoinRoom={goJoin}
        myNickname={myNickname}
        alreadyInRoom={alreadyInRoom}
        onSignOut={signOut}
      />
    </>
  );
}
