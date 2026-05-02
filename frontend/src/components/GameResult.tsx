'use client';

import { motion } from 'framer-motion';
import type { ClientMember } from '@/types/game';

const AVATAR_COLORS = ['bg-blue-500', 'bg-purple-500', 'bg-pink-500', 'bg-orange-500', 'bg-teal-500'];

interface GameResultProps {
  winner: 'landlord' | 'peasants';
  /** Socket IDs of winning players (server-authoritative) */
  winnerIds: string[];
  members: ClientMember[];
  readyCount: number;
  hasVoted: boolean;
  onVote: () => void;
}

export function GameResult({
  winner,
  winnerIds,
  members,
  readyCount,
  hasVoted,
  onVote,
}: GameResultProps) {
  const isLandlordWin = winner === 'landlord';
  const players = members.filter((m) => m.role === 'player');

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
    >
      <motion.div
        initial={{ scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 280, damping: 22 }}
        className="bg-green-900/95 rounded-2xl p-8 w-full max-w-sm flex flex-col items-center gap-6 border border-yellow-400/30 shadow-2xl"
      >
        {/* Winner announcement */}
        <div className="text-center">
          <motion.div
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="text-5xl mb-2"
          >
            {isLandlordWin ? '🏆' : '🎉'}
          </motion.div>
          <h2 className="text-2xl font-black text-white">
            {isLandlordWin ? '地主獲勝！' : '農民獲勝！'}
          </h2>
          <p className="text-yellow-300 text-sm font-bold mt-1">返回大廳中…</p>
        </div>

        {/* Confetti strip */}
        <div className="flex gap-3 flex-wrap justify-center">
          {players.map((member, i) => {
            const isWinner = winnerIds.includes(member.id);
            return (
              <motion.div
                key={member.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 + i * 0.1 }}
                className="flex flex-col items-center gap-1"
              >
                <div
                  className={`w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg ${AVATAR_COLORS[i % AVATAR_COLORS.length]} ${isWinner ? 'ring-2 ring-yellow-400' : 'opacity-60'}`}
                >
                  {member.nickname.charAt(0).toUpperCase()}
                </div>
                <span className="text-white text-xs">{member.nickname}</span>
                {isWinner && <span className="text-yellow-400 text-xs font-bold">勝利</span>}
              </motion.div>
            );
          })}
        </div>

        {/* Re-vote section */}
        <div className="flex flex-col items-center gap-3 w-full">
          <p className="text-white font-bold">再玩一局？({readyCount}/3)</p>
          <div className="flex gap-2 flex-wrap justify-center">
            {members.map((m) => (
              <span
                key={m.id}
                className={[
                  'text-xs px-2 py-1 rounded-full',
                  m.wantToPlay
                    ? 'bg-yellow-400 text-green-900 font-bold'
                    : 'bg-white/20 text-white',
                ].join(' ')}
              >
                {m.wantToPlay ? '✓ ' : ''}{m.nickname}
              </span>
            ))}
          </div>
          <button
            onClick={onVote}
            className={[
              'px-8 py-3 rounded-xl font-bold text-lg transition-colors min-h-[44px] w-full',
              hasVoted
                ? 'bg-red-500 hover:bg-red-400 text-white'
                : 'bg-yellow-400 hover:bg-yellow-300 text-green-900',
            ].join(' ')}
          >
            {hasVoted ? '取消準備' : '再玩一局'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
