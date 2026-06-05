'use client';

import { motion } from 'framer-motion';

interface CoinflipPanelProps {
  hasVoted: boolean;
  onVote: (color: 'white' | 'black') => void;
  votedCount?: number;
}

/**
 * 黑白 (white/black) tiebreak panel. Shown only when nobody volunteered for
 * landlord. Each player picks one colour — palm 🖐 = 白 (white), back of hand
 * 🤚 = 黑 (black). No countdown; the choice locks once pressed, and the round
 * resolves only when all 3 votes are in. The lone colour (1 vs 2) becomes the
 * landlord; an all-same result restarts the vote.
 */
export function CoinflipPanel({ hasVoted, onVote, votedCount = 0 }: CoinflipPanelProps) {
  return (
    <div className="flex flex-col items-center gap-5 p-6 bg-green-900/95 rounded-2xl border border-yellow-400/30 shadow-2xl min-w-[260px]">
      <p className="text-white text-lg font-bold text-center">無人搶地主，猜黑白！</p>

      <p className="text-white/60 text-sm">{votedCount}/3 已選</p>

      {!hasVoted ? (
        <div className="flex gap-4 w-full">
          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={() => onVote('white')}
            className="flex-1 flex flex-col items-center gap-1 px-4 py-3 rounded-xl font-bold bg-white hover:bg-gray-100 text-green-900 transition-colors min-h-[72px]"
          >
            <span className="text-3xl">🖐</span>
            <span className="text-sm">白</span>
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={() => onVote('black')}
            className="flex-1 flex flex-col items-center gap-1 px-4 py-3 rounded-xl font-bold bg-gray-900 hover:bg-gray-800 text-white border border-white/20 transition-colors min-h-[72px]"
          >
            <span className="text-3xl">🤚</span>
            <span className="text-sm">黑</span>
          </motion.button>
        </div>
      ) : (
        <div className="px-8 py-3 rounded-xl font-bold text-base bg-white/20 text-white/50 text-center w-full min-h-[44px] flex items-center justify-center">
          ✓ 已選，等待其他玩家…
        </div>
      )}

      <p className="text-white/40 text-xs text-center">少數的那一位成為地主</p>
    </div>
  );
}
