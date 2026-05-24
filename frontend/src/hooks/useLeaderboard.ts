"use client";

import { useCallback, useEffect, useState } from "react";
import { Socket } from "socket.io-client";

export interface LeaderboardEntry {
  uid: string;
  nickname: string;
  avatarUrl: string | null;
  games: number;
  totalWins: number;
  landlordWins: number;
  farmerWins: number;
  winRate: number;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4896";

export interface UseLeaderboardReturn {
  entries: LeaderboardEntry[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Fetches the global leaderboard. Auto-refreshes when the socket emits
 * `game_over` (a new result was recorded) and `return_to_lobby` (room
 * reopened, scoreboard relevant again).
 */
export function useLeaderboard(socket: Socket): UseLeaderboardReturn {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOnce = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/leaderboard?limit=50`);
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as { entries: LeaderboardEntry[] };
      setEntries(data.entries);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchOnce();
  }, [fetchOnce]);

  // Refresh on game_over / return_to_lobby
  useEffect(() => {
    const refetch = () => {
      // Small delay to let the backend transaction settle before reading.
      setTimeout(fetchOnce, 300);
    };
    socket.on("game_over", refetch);
    socket.on("return_to_lobby", refetch);
    return () => {
      socket.off("game_over", refetch);
      socket.off("return_to_lobby", refetch);
    };
  }, [socket, fetchOnce]);

  return { entries, loading, error, refresh: fetchOnce };
}
