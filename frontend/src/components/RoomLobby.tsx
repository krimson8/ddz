'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { PlayerSeat } from './PlayerSeat';
import type { ClientMember } from '@/types/game';

interface RoomLobbyProps {
  roomCode: string;
  members: ClientMember[];
  myNickname?: string;
  onVote: () => void;
  hasVoted: boolean;
  winCounts: Record<string, number>;
  readyCount: number;
}

export function RoomLobby({
  roomCode,
  members,
  myNickname,
  onVote,
  hasVoted,
  winCounts,
  readyCount,
}: RoomLobbyProps) {
  const [copied, setCopied] = useState(false);
  function copyCode() {
    navigator.clipboard.writeText(roomCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-md mx-auto px-4">

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

      {/* Scoreboard */}
      {Object.keys(winCounts).length > 0 && (
        <div className="w-full">
          <p className="text-white/60 text-xs text-center mb-1">本局戰績</p>
          <div className="flex flex-col gap-1">
            {Object.entries(winCounts)
              .sort(([, a], [, b]) => b - a)
              .map(([nickname, wins]) => (
                <div key={nickname} className="flex justify-between items-center bg-white/10 rounded-lg px-3 py-1">
                  <span className="text-white text-sm">{nickname}</span>
                  <span className="text-yellow-400 font-bold text-sm">{wins} 勝</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Vote prompt */}
      <div className="flex flex-col items-center gap-3">
        <p className="text-white text-base font-bold">
          準備出戰 ({readyCount}/3)
        </p>
        <div className="flex gap-2 flex-wrap justify-center">
          {members.slice(0, 5).map((m) => (
            <span
              key={m.id}
              className={[
                'text-xs px-2 py-1 rounded-full',
                m.wantToPlay
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
          className={[
            'px-8 py-3 rounded-xl font-bold text-lg transition-colors min-h-[44px]',
            hasVoted
              ? 'bg-red-500 hover:bg-red-400 text-white'
              : 'bg-yellow-400 hover:bg-yellow-300 text-green-900',
          ].join(' ')}
        >
          {hasVoted ? '取消準備' : '我要玩！'}
        </button>
      </div>
    </div>
  );
}
