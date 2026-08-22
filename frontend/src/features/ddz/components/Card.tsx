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

export type CardSize = 'mini' | 'normal' | 'large';

const SIZE_CLASS: Record<CardSize, string> = {
  mini: 'w-[28px] h-[40px]',
  normal: 'w-[60px] h-[87px] sm:w-[72px] sm:h-[104px]',
  large: 'w-[96px] h-[140px] sm:w-[120px] sm:h-[174px]',
};

const RADIUS_CLASS: Record<CardSize, string> = {
  mini: 'rounded',
  normal: 'rounded-md',
  large: 'rounded-lg',
};

/** Woven diagonal back with a gold frame — also used by the dealing animation. */
export function CardBack({ size = 'normal', className = '' }: { size?: CardSize; className?: string }) {
  return (
    <div
      className={[
        'relative overflow-hidden shadow-lg',
        SIZE_CLASS[size],
        RADIUS_CLASS[size],
        className,
      ].join(' ')}
      style={{
        background:
          'repeating-linear-gradient(135deg, #14304f 0px, #14304f 5px, #1e4976 5px, #1e4976 10px)',
      }}
    >
      {/* Gold hairline frame */}
      <div className="absolute inset-[3px] rounded-[3px] border border-amber-300/35" />
      {/* Diagonal gloss so the back catches the light as it tumbles */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(115deg, rgba(255,255,255,0.20) 0%, rgba(255,255,255,0) 42%, rgba(0,0,0,0.28) 100%)',
        }}
      />
      {size !== 'mini' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-amber-300/45 font-black leading-none select-none"
            style={{ fontSize: size === 'large' ? 34 : 22 }}>
            鬥
          </span>
        </div>
      )}
    </div>
  );
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
  /**
   * When supplied, the card becomes two-sided and animates a real Y-axis
   * rotation between its back (true) and its face (false). Leave undefined for
   * a plain one-sided card.
   */
  flipped?: boolean;
  /** Delay in seconds before the flip runs — used to cascade a row of reveals. */
  flipDelay?: number;
  /** Static Y-axis tilt in degrees, for cards sitting at an angle on the table. */
  tilt?: number;
  /** Draw a coloured halo — used to mark the cards that won the round. */
  glow?: 'gold' | 'red' | null;
  /** Extra classes on the outer element (e.g. the bomb sheen). */
  className?: string;
}

/** The printed face — pips, corners and all. Split out so the flip can reuse it. */
function CardFace({ suit, rank, size }: { suit: string; rank: number; size: CardSize }) {
  const isJoker = suit === 'joker';
  const colorClass = isJoker || isRed(suit) ? 'text-red-600' : 'text-gray-900';
  const suitSym = isJoker ? '' : SUIT_SYMBOL[suit];
  const label = rankLabel(rank);
  const mini = size === 'mini';
  const large = size === 'large';

  return (
    <div
      className={[
        'absolute inset-0 flex flex-col select-none overflow-hidden',
        RADIUS_CLASS[size],
        mini ? 'p-0' : large ? 'p-[7px] sm:p-[9px] justify-between' : 'p-[4px] sm:p-[5px] justify-between',
        colorClass,
      ].join(' ')}
      style={{
        // Very slight warm tint towards the edges reads as paper stock rather
        // than a flat white rectangle.
        background: 'radial-gradient(115% 115% at 30% 15%, #ffffff 0%, #fdfdfb 55%, #eef0ea 100%)',
      }}
    >
      {/* Inner hairline, skipped on minis where there is no room for it */}
      {!mini && <div className="absolute inset-[2px] rounded-[3px] border border-black/[0.06] pointer-events-none" />}

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
          <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 leading-none opacity-95 ${large ? 'text-[48px] sm:text-[60px]' : 'text-[28px] sm:text-[36px]'}`}>
            {suitSym}
          </div>

          {/* Bottom-right corner (rotated) */}
          <div className="flex flex-col items-center leading-none self-end rotate-180">
            <span className={`font-bold ${large ? 'text-[22px] sm:text-[26px]' : 'text-[13px] sm:text-[15px]'}`}>{label}</span>
            <span className={large ? 'text-[16px] sm:text-[20px]' : 'text-[10px] sm:text-[12px]'}>{suitSym}</span>
          </div>
        </>
      )}
    </div>
  );
}

export function Card({
  suit,
  rank,
  faceDown = false,
  selected = false,
  onClick,
  layoutId,
  mini = false,
  large = false,
  flipped,
  flipDelay = 0,
  tilt = 0,
  glow = null,
  className = '',
}: CardProps) {
  const size: CardSize = mini ? 'mini' : large ? 'large' : 'normal';

  // Two-sided mode: a real rotateY, with both faces mounted and backface-culled.
  if (flipped !== undefined) {
    return (
      <div className={`ddz-scene-near ${SIZE_CLASS[size]} flex-shrink-0 ${className}`}>
        <motion.div
          layoutId={layoutId}
          onClick={onClick}
          className={`preserve-3d relative w-full h-full ${onClick ? 'cursor-pointer' : ''}`}
          initial={false}
          animate={{ rotateY: flipped ? 180 : 0 }}
          transition={{ type: 'spring', stiffness: 160, damping: 18, delay: flipDelay }}
        >
          <div className="backface-hidden absolute inset-0" style={{ transform: 'rotateY(0deg)' }}>
            <div className={`relative w-full h-full shadow-md ${RADIUS_CLASS[size]}`}>
              <CardFace suit={suit} rank={rank} size={size} />
            </div>
          </div>
          <div className="backface-hidden absolute inset-0" style={{ transform: 'rotateY(180deg)' }}>
            <CardBack size={size} className="w-full h-full" />
          </div>
        </motion.div>
      </div>
    );
  }

  if (faceDown) {
    return (
      <motion.div layoutId={layoutId} className={`flex-shrink-0 ${className}`}>
        <CardBack size={size} />
      </motion.div>
    );
  }

  const glowShadow =
    glow === 'gold'
      ? '0 0 0 2px rgba(250,204,21,0.9), 0 0 18px 4px rgba(250,204,21,0.55)'
      : glow === 'red'
        ? '0 0 0 2px rgba(248,113,113,0.9), 0 0 18px 4px rgba(248,113,113,0.5)'
        : selected
          ? '0 10px 20px -4px rgba(0,0,0,0.55)'
          : '0 3px 6px -1px rgba(0,0,0,0.4)';

  return (
    <motion.div
      layoutId={layoutId}
      onClick={onClick}
      whileTap={onClick ? { y: mini ? 0 : -18, scale: 1.04 } : undefined}
      animate={{
        y: selected ? -18 : 0,
        rotateY: tilt,
        boxShadow: glowShadow,
      }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      className={[
        'relative flex-shrink-0 flex flex-col select-none',
        SIZE_CLASS[size],
        RADIUS_CLASS[size],
        mini ? '' : onClick ? 'cursor-pointer' : '',
        selected ? 'ring-2 ring-yellow-300 z-10' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <CardFace suit={suit} rank={rank} size={size} />
    </motion.div>
  );
}
