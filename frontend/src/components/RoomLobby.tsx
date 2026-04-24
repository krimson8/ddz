'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { PlayerSeat } from './PlayerSeat';
import type { ClientMember } from '@/types/game';

const AVATAR_COLORS = ['bg-blue-500', 'bg-purple-500', 'bg-pink-500', 'bg-orange-500', 'bg-teal-500'];

interface RoomLobbyProps {
  roomCode: string;
  members: ClientMember[];
  confirmedVoters: string[];
  myNickname?: string;
  onVote: () => void;
  hasVoted: boolean;
  lastGameResult?: {
    winner: 'landlord' | 'peasants';
    landlordIndex: number | null;
    members: ClientMember[];
  };
}

export function RoomLobby({
  roomCode,
  members,
  confirmedVoters,
  myNickname,
  onVote,
  hasVoted,
  lastGameResult,
}: RoomLobbyProps) {
  const [copied, setCopied] = useState(false);
  const playerCount = members.filter((m) => m.role === 'player').length;
  const canVote = members.length >= 3;

  function copyCode() {
    navigator.clipboard.writeText(roomCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-md mx-auto px-4">

      {/* ── Last game result banner ── */}
      <AnimatePresence>
        {lastGameResult && (
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="w-full bg-black/40 rounded-2xl p-4 border border-yellow-400/30"
          >
            <p className="text-yellow-400 font-black text-xl text-center mb-3">
              {lastGameResult.winner === 'landlord' ? '🏆 地主獲勝！' : '🎉 農民獲勝！'}
            </p>
            <div className="flex justify-center gap-4">
              {lastGameResult.members.filter((m) => m.role === 'player').map((m, i) => {
                const isLandlord = i === lastGameResult.landlordIndex;
                const isWinner =
                  lastGameResult.winner === 'landlord' ? isLandlord : !isLandlord;
                return (
                  <div key={m.id} className="flex flex-col items-center gap-1">
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold ${AVATAR_COLORS[i % AVATAR_COLORS.length]} ${isWinner ? 'ring-2 ring-yellow-400' : 'opacity-50'}`}
                    >
                      {m.nickname.charAt(0).toUpperCase()}
                    </div>
                    <span className="text-white text-[11px]">{m.nickname}</span>
                    {isLandlord && <span className="text-yellow-400 text-[10px] font-bold">地主</span>}
                    {isWinner && <span className="text-green-300 text-[10px] font-bold">勝利</span>}
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Room code */}
      <div className="flex flex-col items-center gap-1">
        <span className="text-white/60 text-sm">房間代碼</span>
        <button
          onClick={copyCode}
          className="text-3xl font-bold tracking-widest text-yellow-400 hover:text-yellow-300 transition-colors"
        >
          {roomCode}
        </button>
        <AnimatePresence>
          {copied && (
            <motion.span
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="text-green-300 text-xs"
            >
              已複製！
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {/* Member strip */}
      <div className="flex gap-4 flex-wrap justify-center">
        <AnimatePresence>
          {members.map((member, i) => (
            <PlayerSeat
              key={member.id}
              nickname={member.nickname}
              role={member.role}
              colorIndex={i}
            />
          ))}
        </AnimatePresence>
      </div>

      {/* Status */}
      <p className="text-white/60 text-sm">
        {playerCount < 3 ? `等待玩家加入 (${members.length}/3)…` : `玩家人數已足夠`}
      </p>

      {/* Vote prompt */}
      {canVote && (
        <div className="flex flex-col items-center gap-3">
          <p className="text-white text-base font-bold">
            我要玩！({confirmedVoters.length}/3)
          </p>
          <div className="flex gap-2 flex-wrap justify-center">
            {members.slice(0, 5).map((m) => (
              <span
                key={m.id}
                className={[
                  'text-xs px-2 py-1 rounded-full',
                  confirmedVoters.includes(m.nickname)
                    ? 'bg-yellow-400 text-green-900 font-bold'
                    : 'bg-white/20 text-white',
                ].join(' ')}
              >
                {m.nickname}
              </span>
            ))}
          </div>
          <button
            onClick={onVote}
            disabled={hasVoted}
            className="px-8 py-3 rounded-xl font-bold text-lg bg-yellow-400 hover:bg-yellow-300 disabled:opacity-40 disabled:cursor-not-allowed text-green-900 transition-colors min-h-[44px]"
          >
            {hasVoted ? '已準備' : '我要玩'}
          </button>
        </div>
      )}
    </div>
  );
}
