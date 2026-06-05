'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import type { StoneColor, WinnerColor, WinReason } from '@/features/wuziqi/types';

interface HistoryPlayer {
  uid: string;
  nickname: string;
  avatarUrl: string | null;
  color: StoneColor;
  won: boolean;
}

interface HistoryRow {
  gameId: number;
  playedAt: string;
  winnerColor: WinnerColor;
  winReason: WinReason;
  hasMoves: boolean;
  myColor: StoneColor;
  myWon: boolean;
  players: HistoryPlayer[];
}

const REASON_LABEL: Record<WinReason, string> = {
  five: '五子連線',
  timeout: '超時',
  resign: '認輸',
  disconnect: '斷線',
  draw: '平手',
};

export function WuziqiHistory() {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<{ games: HistoryRow[] }>('/users/me/games?limit=20', {}, 'wuziqi');
      setRows(data.games);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="bg-white/10 backdrop-blur rounded-2xl p-6 flex flex-col gap-3">
      <h2 className="text-sm uppercase tracking-wider text-white/60">對局記錄</h2>
      {loading ? (
        <p className="text-white/40 text-sm text-center py-2">載入中…</p>
      ) : error ? (
        <p className="text-red-300 text-sm">{error}</p>
      ) : rows.length === 0 ? (
        <p className="text-white/40 text-sm text-center py-2">尚無對局記錄</p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((r) => {
            const isDraw = r.winnerColor === 'draw';
            const opponent = r.players.find((p) => p.color !== r.myColor);
            return (
              <div
                key={r.gameId}
                className="flex items-center gap-3 bg-white/5 rounded-lg px-3 py-2 text-sm"
              >
                <span
                  className={[
                    'text-xs font-bold px-2 py-0.5 rounded-full',
                    isDraw
                      ? 'bg-white/20 text-white'
                      : r.myWon
                        ? 'bg-yellow-400 text-green-900'
                        : 'bg-white/10 text-white/50',
                  ].join(' ')}
                >
                  {isDraw ? '平手' : r.myWon ? '勝' : '負'}
                </span>
                <span className="flex items-center gap-1 text-white/80">
                  <span
                    className="w-3 h-3 rounded-full inline-block border border-black/30"
                    style={{
                      background:
                        r.myColor === 'black'
                          ? 'radial-gradient(circle at 32% 28%, #555, #000)'
                          : 'radial-gradient(circle at 32% 28%, #fff, #cfcfcf)',
                    }}
                  />
                  {r.myColor === 'black' ? '黑' : '白'}
                </span>
                <span className="text-white/50 flex-1 truncate">
                  vs {opponent?.nickname ?? '?'}
                </span>
                <span className="text-white/40 text-xs">{REASON_LABEL[r.winReason]}</span>
                <span className="text-white/30 text-xs">
                  {new Date(r.playedAt).toLocaleDateString()}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
