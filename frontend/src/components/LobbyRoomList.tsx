"use client";

import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import type { RoomListEntry } from "@/hooks/useRoomList";

interface LobbyRoomListProps {
  rooms: RoomListEntry[];
  onCreateRoom: () => void;
  onJoinRoom: (code: string) => void;
  myNickname: string;
  /** If user is already in some room, the create button is disabled. */
  alreadyInRoom: boolean;
  onSignOut: () => void;
}

function Avatar({
  url,
  nickname,
  size = 40,
}: {
  url: string | null;
  nickname: string;
  size?: number;
}) {
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={nickname}
        className="rounded-full object-cover bg-white/10"
        style={{ width: size, height: size }}
      />
    );
  }
  const initial = nickname.slice(0, 1).toUpperCase();
  return (
    <div
      className="rounded-full bg-yellow-400 text-green-900 font-bold flex items-center justify-center"
      style={{ width: size, height: size, fontSize: size * 0.5 }}
    >
      {initial}
    </div>
  );
}

function PhaseBadge({ phase }: { phase: RoomListEntry["phase"] }) {
  const label = phase === "waiting" ? "等待中" : phase === "bidding" ? "叫地主" : "進行中";
  const cls =
    phase === "waiting"
      ? "bg-green-500/30 text-green-200"
      : phase === "bidding"
        ? "bg-yellow-500/30 text-yellow-200"
        : "bg-red-500/30 text-red-200";
  return <span className={`text-xs px-2 py-0.5 rounded-full ${cls}`}>{label}</span>;
}

export function LobbyRoomList({
  rooms,
  onCreateRoom,
  onJoinRoom,
  myNickname,
  alreadyInRoom,
  onSignOut,
}: LobbyRoomListProps) {
  return (
    <div className="min-h-screen bg-green-900 text-white p-4">
      <div className="max-w-2xl mx-auto flex flex-col gap-6">
        {/* Header */}
        <div className="flex justify-between items-center pt-2">
          <h1 className="text-2xl font-bold">🀄 鬥地主大廳</h1>
          <div className="flex items-center gap-3 text-sm">
            <Link
              href="/profile"
              className="text-white/70 hover:text-white underline-offset-2 hover:underline"
            >
              {myNickname}
            </Link>
            <button
              className="text-white/60 hover:text-white underline"
              onClick={onSignOut}
            >
              登出
            </button>
          </div>
        </div>

        {/* Create button */}
        <div className="flex flex-col gap-2">
          <button
            disabled={alreadyInRoom}
            onClick={onCreateRoom}
            className="rounded-xl py-3 px-6 bg-yellow-400 hover:bg-yellow-300 text-green-900 font-bold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            ＋ 建立房間
          </button>
          {alreadyInRoom && (
            <p className="text-xs text-white/60 text-center">
              你已在房間中
            </p>
          )}
        </div>

        {/* Room list */}
        <div className="flex flex-col gap-3">
          <h2 className="text-sm uppercase tracking-wider text-white/60">
            活躍房間 ({rooms.length})
          </h2>

          {rooms.length === 0 && (
            <div className="bg-white/5 rounded-xl p-6 text-center text-white/60 text-sm">
              還沒有房間，按上面的按鈕來建立一個吧
            </div>
          )}

          <AnimatePresence initial={false}>
            {rooms.map((room) => (
              <motion.div
                key={room.code}
                layout
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="bg-white/10 backdrop-blur rounded-xl p-4 flex flex-col gap-3"
              >
                <div className="flex justify-between items-start gap-3">
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-bold tracking-widest">
                      {room.code}
                    </span>
                    <PhaseBadge phase={room.phase} />
                  </div>
                  <button
                    onClick={() => onJoinRoom(room.code)}
                    disabled={alreadyInRoom && room.myMembership === "none"}
                    className={`rounded-lg px-4 py-2 text-sm font-bold transition-colors ${
                      room.myMembership !== "none"
                        ? "bg-green-500 hover:bg-green-400 text-white"
                        : "bg-white/20 hover:bg-white/30 text-white disabled:opacity-40 disabled:cursor-not-allowed"
                    }`}
                  >
                    {room.myMembership !== "none" ? "↩ 重新加入" : "加入"}
                  </button>
                </div>

                {/* Member avatars */}
                <div className="flex items-center gap-3 flex-wrap">
                  {room.phase === "waiting"
                    ? room.members.map((m) => (
                        <div key={m.uid} className="flex flex-col items-center gap-1">
                          <Avatar url={m.avatarUrl} nickname={m.nickname} size={72} />
                          <span className="text-xs text-white/70 max-w-[60px] truncate">
                            {m.nickname}
                          </span>
                        </div>
                      ))
                    : room.members
                        .filter((m) => m.isPlayer)
                        .map((m) => (
                          <div
                            key={m.uid}
                            className={`flex flex-col items-center gap-1 ${
                              m.isCurrentTurn
                                ? "ring-2 ring-yellow-400 rounded-lg p-1 -m-1"
                                : ""
                            }`}
                          >
                            <Avatar url={m.avatarUrl} nickname={m.nickname} size={80} />
                            <span className="text-xs text-white/80 max-w-[60px] truncate">
                              {m.nickname}
                            </span>
                          </div>
                        ))}

                  {room.phase !== "waiting" && room.spectatorCount > 0 && (
                    <span className="text-xs text-white/50 ml-2">
                      +{room.spectatorCount} 觀戰
                    </span>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
