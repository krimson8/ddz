'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

const BID_SECONDS = 8;

interface BiddingPanelProps {
  hasVoted: boolean;
  onVoteYes: () => void;
  votedCount?: number;
}

export function BiddingPanel({ hasVoted, onVoteYes, votedCount = 0 }: BiddingPanelProps) {
  const [timeLeft, setTimeLeft] = useState(BID_SECONDS);

  // Self-contained countdown; resets on each mount (i.e. each new bid_open)
  useEffect(() => {
    setTimeLeft(BID_SECONDS);
  }, []);

  useEffect(() => {
    if (timeLeft <= 0) return;
    const id = setTimeout(() => setTimeLeft((t) => t - 1), 1000);
    return () => clearTimeout(id);
  }, [timeLeft]);

  const isExpired = timeLeft <= 0;

  return (
    <div className="flex flex-col items-center gap-5 p-6 bg-green-900/95 rounded-2xl border border-yellow-400/30 shadow-2xl min-w-[260px]">
      <p className="text-white text-lg font-bold text-center">誰要做地主？</p>

      {/* Countdown ring */}
      <div className={`text-4xl font-black tabular-nums transition-colors ${timeLeft <= 5 ? 'text-red-400' : 'text-yellow-400'}`}>
        {isExpired ? '⏰' : `${timeLeft}s`}
      </div>

      {/* Voted indicator */}
      <p className="text-white/60 text-sm">{votedCount}/3 已決定</p>

      {/* Vote button */}
      {!hasVoted && !isExpired ? (
        <motion.button
          whileTap={{ scale: 0.92 }}
          onClick={onVoteYes}
          className="px-8 py-3 rounded-xl font-bold text-base bg-yellow-400 hover:bg-yellow-300 text-green-900 transition-colors min-h-[44px] w-full"
        >
          我要做地主！
        </motion.button>
      ) : (
        <div className="px-8 py-3 rounded-xl font-bold text-base bg-white/20 text-white/50 text-center w-full min-h-[44px] flex items-center justify-center">
          {hasVoted ? '✓ 已投票' : '時間到，等待結果…'}
        </div>
      )}

      <p className="text-white/40 text-xs text-center">不點擊即為「不做地主」</p>
    </div>
  );
}
