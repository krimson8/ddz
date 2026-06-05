"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

export interface WuziqiStats {
  uid: string;
  nickname: string;
  avatarUrl: string | null;
  games: number;
  wins: number;
  blackWins: number;
  whiteWins: number;
  winRate: number;
}

/**
 * Wuziqi stats for the current user, read from the wuziqi backend. Identity
 * (nickname/avatar) is shared with DDZ via the common `users` table, so this
 * hook only owns the per-game stats — useProfile handles identity.
 */
export function useWuziqiStats(): {
  stats: WuziqiStats | null;
  loading: boolean;
  error: string | null;
} {
  const { user, loading: authLoading } = useAuth();
  const [stats, setStats] = useState<WuziqiStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    setError(null);
    try {
      const resp = await apiFetch<WuziqiStats | null>("/users/me/stats", {}, "wuziqi");
      setStats(resp);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setStats(null);
      setLoading(false);
      return;
    }
    void refresh();
  }, [authLoading, user, refresh]);

  return { stats, loading, error };
}
