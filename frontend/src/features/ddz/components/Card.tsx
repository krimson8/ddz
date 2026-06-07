'use client';

import { motion } from 'framer-motion';
import type { Card as CardType } from '@/features/ddz/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

const SUIT_SYMBOL: Record<string, string> = {
  spade: '♠',
  heart: '♥',
  diamond: '♦',
  club: '♣',
};

function rankLabel(rank: number): string {
  if (rank <= 10) return String(rank);
  if (rank === 11) return 'J';
  if (rank === 12) return 'Q';
  if (rank === 13) return 'K';
  if (rank === 14) return 'A';
  if (rank === 15) return '2';
  return ''; // jokers handled separately
}

function isRed(suit: string): boolean {
  return suit === 'heart' || suit === 'diamond';
}

// ── Card Component ────────────────────────────────────────────────────────────

export interface CardProps extends CardType {
  faceDown?: boolean;
  selected?: boolean;
  onClick?: () => void;
  /** Used for shared-layout animation across hand → play area */
  layoutId?: string;
  /** Render as a tiny card (for landlord indicator / history panel) */
  mini?: boolean;
  /** Render extra-large (for the central play area) */
  large?: boolean;
}

export function Card({ suit, rank, faceDown = false, selected = false, onClick, layoutId, mini = false, large = false }: CardProps) {
  if (faceDown) {
    return (
      <motion.div
        layoutId={layoutId}
        className={[
          'relative flex-shrink-0 rounded-lg overflow-hidden shadow-md',
          mini
            ? 'w-[28px] h-[40px]'
            : large
              ? 'w-[96px] h-[140px] sm:w-[120px] sm:h-[174px]'
              : 'w-[60px] h-[87px] sm:w-[72px] sm:h-[104px]',
        ].join(' ')}
        style={{
          background:
            'repeating-linear-gradient(135deg, #1a3a5c 0px, #1a3a5c 6px, #1e4976 6px, #1e4976 12px)',
        }}
      >
        <div className="absolute inset-[4px] border border-white/25 rounded" />
      </motion.div>
    );
  }

  const isJoker = suit === 'joker';
  const colorClass = isJoker || isRed(suit) ? 'text-red-600' : 'text-gray-900';
  const suitSym = isJoker ? '' : SUIT_SYMBOL[suit];
  const label = rankLabel(rank);

  return (
    <motion.div
      layoutId={layoutId}
      onClick={onClick}
      whileTap={onClick ? { y: mini ? 0 : -14 } : undefined}
      animate={selected ? { y: -14 } : { y: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      className={[
        'relative flex-shrink-0 bg-white rounded shadow-md flex flex-col select-none',
        mini
          ? 'w-[28px] h-[40px] p-0 overflow-hidden'
          : large
            ? 'w-[96px] h-[140px] sm:w-[120px] sm:h-[174px] p-[7px] sm:p-[9px] justify-between'
            : 'w-[60px] h-[87px] sm:w-[72px] sm:h-[104px] p-[4px] sm:p-[5px] cursor-pointer justify-between',
        selected ? 'ring-2 ring-yellow-400 shadow-lg' : '',
        colorClass,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {isJoker ? (
        mini ? (
          <>
            {/* Mini joker: top half = 小/大, bottom half = 王 */}
            <div className={`flex-1 flex items-center justify-center font-bold text-[11px] leading-none ${rank === 16 ? 'text-gray-700' : 'text-red-600'}`}>
              {rank === 16 ? '小' : '大'}
            </div>
            <div className={`flex-1 flex items-center justify-center font-bold text-[11px] leading-none ${rank === 16 ? 'text-gray-700' : 'text-red-600'}`}>
              王
            </div>
          </>
        ) : (
          <>
            {/* Joker content */}
            <div className={`font-bold leading-tight ${large ? 'text-[18px] sm:text-[22px]' : 'text-[11px]'}`}>
              {rank === 16 ? (
                <span className="text-gray-700">小{'\n'}王</span>
              ) : (
                <span className="text-red-600">大{'\n'}王</span>
              )}
            </div>
            <div
              className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 font-bold text-center leading-snug whitespace-nowrap ${large ? 'text-[18px] sm:text-[22px]' : 'text-[11px]'}`}
              style={{ color: rank === 16 ? '#374151' : '#ef4444' }}
            >
              {rank === 16 ? '小\n王' : '大\n王'}
            </div>
          </>
        )
      ) : mini ? (
        <>
          {/* Mini layout: top half = rank, bottom half = suit */}
          <div className="flex-1 flex items-center justify-center">
            <span className="font-bold text-[14px] leading-none">{label}</span>
          </div>
          <div className="flex-1 flex items-center justify-center">
            <span className="text-[12px] leading-none">{suitSym}</span>
          </div>
        </>
      ) : (
        <>
          {/* Top-left corner */}
          <div className="flex flex-col items-center leading-none">
            <span className={`font-bold ${large ? 'text-[22px] sm:text-[26px]' : 'text-[13px] sm:text-[15px]'}`}>{label}</span>
            <span className={large ? 'text-[16px] sm:text-[20px]' : 'text-[10px] sm:text-[12px]'}>{suitSym}</span>
          </div>

          {/* Centre suit */}
          <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 leading-none ${large ? 'text-[48px] sm:text-[60px]' : 'text-[28px] sm:text-[36px]'}`}>
            {suitSym}
          </div>

          {/* Bottom-right corner (rotated) */}
          <div className="flex flex-col items-center leading-none self-end rotate-180">
            <span className={`font-bold ${large ? 'text-[22px] sm:text-[26px]' : 'text-[13px] sm:text-[15px]'}`}>{label}</span>
            <span className={large ? 'text-[16px] sm:text-[20px]' : 'text-[10px] sm:text-[12px]'}>{suitSym}</span>
          </div>
        </>
      )}
    </motion.div>
  );
}
