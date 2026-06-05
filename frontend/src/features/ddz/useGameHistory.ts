"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

export interface HistoryPlayer {
  uid: string;
  nickname: string;
  avatarUrl: string | null;
  role: "landlord" | "farmer";
  won: boolean;
  seat: number;
}

export interface HistoryRow {
  gameId: number;
  playedAt: string;
  winnerRole: "landlord" | "farmer";
  hasPlays: boolean;
  myRole: "landlord" | "farmer";
  myWon: boolean;
  mySeat: number;
  players: HistoryPlayer[];
}

const PAGE_SIZE = 20;

export function useGameHistory() {
  const { user, loading: authLoading } = useAuth();
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchPage = useCallback(
    async (before?: number) => {
      const qs = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (before !== undefined) qs.set("before", String(before));
      const data = await apiFetch<{ games: HistoryRow[] }>(
        `/users/me/games?${qs.toString()}`,
      );
      return data.games;
    },
    [],
  );

  const initial = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const page = await fetchPage();
      setRows(page);
      setHasMore(page.length === PAGE_SIZE);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [fetchPage]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setRows([]);
      setLoading(false);
      return;
    }
    void initial();
  }, [authLoading, user, initial]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || rows.length === 0) return;
    setLoadingMore(true);
    try {
      const last = rows[rows.length - 1];
      const page = await fetchPage(last.gameId);
      setRows((prev) => [...prev, ...page]);
      setHasMore(page.length === PAGE_SIZE);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingMore(false);
    }
  }, [fetchPage, hasMore, loadingMore, rows]);

  return { rows, loading, error, hasMore, loadingMore, loadMore, refresh: initial };
}

// ── Single-game detail (for replay modal) ────────────────────────────────────

export interface ReplayPlay {
  seat: number;
  cards: { suit: string; rank: number }[];
}

export interface GameDetail {
  gameId: number;
  playedAt: string;
  winnerRole: "landlord" | "farmer";
  plays: ReplayPlay[];
  players: HistoryPlayer[];
}

export function useGameDetail(gameId: number | null) {
  const [game, setGame] = useState<GameDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (gameId == null) {
      setGame(null);
      return;
    }
    setLoading(true);
    setError(null);
    apiFetch<GameDetail>(`/games/${gameId}`)
      .then((data) => setGame(data))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [gameId]);

  return { game, loading, error };
}
