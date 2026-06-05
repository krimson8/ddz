'use client';

import { motion } from 'framer-motion';
import type { StoneColor } from '@/features/wuziqi/types';

interface StoneProps {
  color: StoneColor;
  /** Highlight as the last-placed stone. */
  last?: boolean;
  /** Highlight as part of the winning line. */
  winning?: boolean;
}

/** A black/white stone with a subtle drop-in animation. */
export function Stone({ color, last, winning }: StoneProps) {
  const isBlack = color === 'black';
  return (
    <motion.div
      initial={{ scale: 0.2, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 500, damping: 28 }}
      className="absolute inset-0 flex items-center justify-center pointer-events-none"
    >
      <div
        className="rounded-full"
        style={{
          width: '86%',
          height: '86%',
          background: isBlack
            ? 'radial-gradient(circle at 32% 28%, #555 0%, #111 60%, #000 100%)'
            : 'radial-gradient(circle at 32% 28%, #fff 0%, #e8e8e8 55%, #bfbfbf 100%)',
          boxShadow: winning
            ? '0 0 0 2px rgba(250,204,21,0.95), 0 0 10px 3px rgba(250,204,21,0.8)'
            : '0 1px 2px rgba(0,0,0,0.5)',
          border: isBlack ? 'none' : '1px solid rgba(0,0,0,0.15)',
        }}
      />
      {last && !winning && (
        <span
          className="absolute rounded-full"
          style={{
            width: '20%',
            height: '20%',
            background: isBlack ? 'rgba(255,255,255,0.9)' : 'rgba(220,38,38,0.9)',
          }}
        />
      )}
    </motion.div>
  );
}
