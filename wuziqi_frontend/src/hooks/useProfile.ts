"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "./useAuth";

export interface MeResponse {
  uid: string;
  email: string;
  nickname: string;
  avatarUrl: string | null;
}

export interface MyStats {
  uid: string;
  nickname: string;
  avatarUrl: string | null;
  games: number;
  wins: number;
  blackWins: number;
  whiteWins: number;
  winRate: number;
}

export interface UseProfileReturn {
  me: MeResponse | null;
  stats: MyStats | null;
  loading: boolean;
  error: string | null;
  updateNickname: (nickname: string) => Promise<void>;
  updateAvatar: (avatarUrl: string | null) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useProfile(): UseProfileReturn {
  const { user, loading: authLoading } = useAuth();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [stats, setStats] = useState<MyStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    setError(null);
    try {
      const [meResp, statsResp] = await Promise.all([
        apiFetch<MeResponse>("/auth/me"),
        apiFetch<MyStats | null>("/users/me/stats"),
      ]);
      setMe(meResp);
      setStats(statsResp);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setMe(null);
      setStats(null);
      setLoading(false);
      return;
    }
    void refresh();
  }, [authLoading, user, refresh]);

  const updateNickname = useCallback(
    async (nickname: string) => {
      const prev = me;
      // Optimistic update
      if (me) setMe({ ...me, nickname });
      try {
        const updated = await apiFetch<MeResponse>("/users/me", {
          method: "PATCH",
          body: JSON.stringify({ nickname }),
        });
        setMe(updated);
      } catch (err) {
        // Revert on failure
        if (prev) setMe(prev);
        throw err;
      }
    },
    [me],
  );

  const updateAvatar = useCallback(
    async (avatarUrl: string | null) => {
      const prev = me;
      if (me) setMe({ ...me, avatarUrl });
      try {
        const updated = await apiFetch<MeResponse>("/users/me", {
          method: "PATCH",
          body: JSON.stringify({ avatarUrl }),
        });
        setMe(updated);
      } catch (err) {
        if (prev) setMe(prev);
        throw err;
      }
    },
    [me],
  );

  return { me, stats, loading, error, updateNickname, updateAvatar, refresh };
}
