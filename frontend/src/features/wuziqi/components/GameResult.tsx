'use client';

import { motion } from 'framer-motion';
import type { WinnerColor, WinReason } from '@/features/wuziqi/types';

interface GameResultProps {
  winnerColor: WinnerColor;
  winReason: WinReason;
  /** True if the local player won (false for loss / draw / spectator). */
  iWon: boolean;
  isSpectator: boolean;
}

const REASON_LABEL: Record<WinReason, string> = {
  five: '五子連線',
  timeout: '超時',
  resign: '認輸',
  disconnect: '對手斷線',
  draw: '平手',
};

export function GameResult({
  winnerColor,
  winReason,
  iWon,
  isSpectator,
}: GameResultProps) {
  const isDraw = winnerColor === 'draw';
  const colorLabel = winnerColor === 'black' ? '黑棋' : winnerColor === 'white' ? '白棋' : '';

  let headline: string;
  let emoji: string;
  if (isDraw) {
    headline = '平手';
    emoji = '🤝';
  } else if (isSpectator) {
    headline = `${colorLabel}獲勝！`;
    emoji = '🏆';
  } else {
    headline = iWon ? '你贏了！' : '你輸了';
    emoji = iWon ? '🎉' : '😢';
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4"
    >
      <motion.div
        initial={{ scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 280, damping: 22 }}
        className="bg-green-900/95 rounded-2xl p-8 w-full max-w-sm flex flex-col items-center gap-4 border border-yellow-400/30 shadow-2xl"
      >
        <motion.div
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="text-5xl"
        >
          {emoji}
        </motion.div>
        <h2 className="text-3xl font-black text-white text-center">{headline}</h2>
        {!isDraw && (
          <p className="text-white/80 text-center">
            <span className="font-bold text-yellow-300">{colorLabel}</span> 獲勝 ·{' '}
            {REASON_LABEL[winReason]}
          </p>
        )}
        {isDraw && (
          <p className="text-white/80 text-center">棋盤已滿，無人連成五子</p>
        )}
        <p className="text-yellow-300 text-sm font-bold mt-2">返回房間中…</p>
      </motion.div>
    </motion.div>
  );
}
