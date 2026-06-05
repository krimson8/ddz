"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Card as CardComponent } from "./Card";
import {
  useGameDetail,
  useGameHistory,
  type HistoryPlayer,
  type HistoryRow,
} from "@/features/ddz/useGameHistory";

function MiniAvatar({ player, size = 28 }: { player: HistoryPlayer; size?: number }) {
  if (player.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={player.avatarUrl}
        alt={player.nickname}
        className="rounded-full object-cover bg-white/10 flex-shrink-0"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="rounded-full bg-yellow-400 text-green-900 font-bold flex items-center justify-center flex-shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {player.nickname.slice(0, 1).toUpperCase()}
    </span>
  );
}

function RoleBadge({ role }: { role: "landlord" | "farmer" }) {
  return (
    <span
      className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
        role === "landlord" ? "bg-yellow-400 text-green-900" : "bg-white/20 text-white"
      }`}
    >
      {role === "landlord" ? "地主" : "農民"}
    </span>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function HistoryRowCard({
  row,
  onClick,
}: {
  row: HistoryRow;
  onClick: () => void;
}) {
  const clickable = row.hasPlays;
  return (
    <button
      onClick={clickable ? onClick : undefined}
      disabled={!clickable}
      className={`w-full text-left bg-white/10 rounded-lg p-3 flex flex-col gap-2 ${
        clickable ? "hover:bg-white/15 cursor-pointer" : "opacity-70 cursor-default"
      }`}
    >
      <div className="flex items-center justify-between text-xs">
        <span className="text-white/50">{formatDate(row.playedAt)}</span>
        <span
          className={`font-bold ${row.myWon ? "text-green-300" : "text-red-300"}`}
        >
          {row.myWon ? "勝" : "負"} · {row.myRole === "landlord" ? "地主" : "農民"}
        </span>
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        {row.players.map((p) => (
          <div key={p.uid} className="flex items-center gap-1.5 min-w-0">
            <MiniAvatar player={p} size={28} />
            <div className="flex flex-col min-w-0">
              <span className="text-white text-xs truncate max-w-[80px]">
                {p.nickname}
              </span>
              <div className="flex items-center gap-1">
                <RoleBadge role={p.role} />
                {p.won && <span className="text-[10px] text-yellow-300">★</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
      {!clickable && (
        <span className="text-white/40 text-[10px] italic">回放資料已清除</span>
      )}
    </button>
  );
}

function ReplayModal({
  gameId,
  onClose,
}: {
  gameId: number;
  onClose: () => void;
}) {
  const { game, loading, error } = useGameDetail(gameId);

  const playerBySeat = new Map<number, HistoryPlayer>();
  game?.players.forEach((p) => playerBySeat.set(p.seat, p));

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur flex items-center justify-center p-4"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-green-900 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden border border-white/10"
      >
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <div className="flex flex-col">
            <h2 className="text-white font-bold">遊戲回放</h2>
            {game && (
              <span className="text-white/50 text-xs">
                {formatDate(game.playedAt)} · {game.winnerRole === "landlord" ? "地主勝" : "農民勝"}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-white/60 hover:text-white text-xl leading-none w-8 h-8 flex items-center justify-center"
          >
            ✕
          </button>
        </div>

        {/* Players strip */}
        {game && (
          <div className="px-4 py-3 border-b border-white/10 flex gap-3 flex-wrap">
            {game.players.map((p) => (
              <div key={p.uid} className="flex items-center gap-2">
                <MiniAvatar player={p} size={32} />
                <div className="flex flex-col">
                  <span className="text-white text-sm">{p.nickname}</span>
                  <div className="flex items-center gap-1">
                    <RoleBadge role={p.role} />
                    {p.won && <span className="text-[10px] text-yellow-300">★</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Plays list */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2">
          {loading && <p className="text-white/60 text-center text-sm">載入中…</p>}
          {error && <p className="text-red-300 text-center text-sm">{error}</p>}
          {game && game.plays.length === 0 && (
            <p className="text-white/40 text-center text-sm italic py-4">無回放資料</p>
          )}
          {game?.plays.map((play, i) => {
            const player = playerBySeat.get(play.seat);
            return (
              <div
                key={i}
                className="flex items-center gap-3 bg-white/5 rounded-lg p-2"
              >
                <span className="text-white/40 text-xs w-6 text-right flex-shrink-0">
                  {i + 1}
                </span>
                {player && (
                  <div className="flex items-center gap-2 w-32 flex-shrink-0">
                    <MiniAvatar player={player} size={28} />
                    <div className="flex flex-col min-w-0">
                      <span className="text-white text-xs truncate">
                        {player.nickname}
                      </span>
                      <RoleBadge role={player.role} />
                    </div>
                  </div>
                )}
                <div className="flex gap-1 overflow-x-auto flex-1 min-w-0">
                  {play.cards.map((c, ci) => (
                    <CardComponent
                      key={ci}
                      suit={c.suit as "spade" | "heart" | "diamond" | "club" | "joker"}
                      rank={c.rank}
                      mini
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </motion.div>
    </motion.div>
  );
}

export function GameHistory() {
  const { rows, loading, error, hasMore, loadingMore, loadMore } = useGameHistory();
  const [openGameId, setOpenGameId] = useState<number | null>(null);

  return (
    <div className="bg-white/10 backdrop-blur rounded-2xl p-6 flex flex-col gap-4">
      <h2 className="text-sm uppercase tracking-wider text-white/60">對局紀錄</h2>

      {loading && <p className="text-white/40 text-sm text-center py-4">載入中…</p>}
      {error && <p className="text-red-300 text-sm">{error}</p>}
      {!loading && rows.length === 0 && (
        <p className="text-white/40 text-sm text-center py-4">尚無對局紀錄</p>
      )}

      <div className="flex flex-col gap-2">
        {rows.map((row) => (
          <HistoryRowCard
            key={row.gameId}
            row={row}
            onClick={() => setOpenGameId(row.gameId)}
          />
        ))}
      </div>

      {hasMore && rows.length > 0 && (
        <button
          onClick={loadMore}
          disabled={loadingMore}
          className="text-white/60 hover:text-white text-sm underline self-center disabled:opacity-50"
        >
          {loadingMore ? "載入中…" : "載入更多"}
        </button>
      )}

      <AnimatePresence>
        {openGameId !== null && (
          <ReplayModal
            gameId={openGameId}
            onClose={() => setOpenGameId(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
