'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Card } from './Card';
import type { Card as CardType } from '@/features/ddz/types';

const AVATAR_COLORS = [
  'bg-blue-500',
  'bg-purple-500',
  'bg-pink-500',
  'bg-orange-500',
  'bg-teal-500',
];

/**
 * The landlord's three bottom cards, revealed with a cascading 3D flip rather
 * than a fade. They arrive face-down and turn over a beat later, which is the
 * gesture the moment actually calls for.
 */
function LandlordCards({ cards, className = '' }: { cards: CardType[]; className?: string }) {
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setRevealed(true), 280);
    return () => clearTimeout(t);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.7 }}
      animate={{ opacity: 1, scale: 1 }}
      className={`flex gap-0.5 ${className}`}
    >
      {cards.map((card, i) => (
        <Card key={`${card.suit}-${card.rank}`} {...card} mini flipped={!revealed} flipDelay={i * 0.13} />
      ))}
    </motion.div>
  );
}

/** How many cards left before the seat starts shouting about it. */
const ALERT_AT = 2;

/**
 * Remaining-card readout: a little stack of card edges whose height tracks the
 * count, plus the number. Far quicker to read across the table than bare text,
 * and it turns into a 報單/報雙 alert once the player is nearly out.
 */
function CardCountBadge({ count, className = '' }: { count: number; className?: string }) {
  const alert = count > 0 && count <= ALERT_AT;
  // Cap the drawn stack — past a dozen edges it is just mush.
  const slivers = Math.min(count, 12);

  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <div className="flex items-end h-[14px]" aria-hidden>
        {Array.from({ length: slivers }).map((_, i) => (
          <span
            key={i}
            className="block w-[2px] rounded-[1px]"
            style={{
              height: 6 + Math.min(count, 17) * 0.45,
              marginLeft: i === 0 ? 0 : 1,
              background: alert ? 'rgba(248,113,113,0.95)' : 'rgba(255,255,255,0.65)',
            }}
          />
        ))}
      </div>
      <motion.span
        className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold tabular-nums ${
          alert ? 'bg-red-500 text-white' : 'bg-black/40 text-white'
        }`}
        animate={alert ? { scale: [1, 1.14, 1] } : { scale: 1 }}
        transition={alert ? { duration: 0.9, repeat: Infinity, ease: 'easeInOut' } : {}}
      >
        {alert ? (count === 1 ? '報單!' : '報雙!') : `${count}張`}
      </motion.span>
    </div>
  );
}

interface PlayerSeatProps {
  nickname: string;
  avatarUrl?: string | null;
  role?: 'player' | 'spectator';
  isLandlord?: boolean;
  /** The 3 landlord bottom-cards to display next to the landlord avatar */
  landlordCards?: CardType[];
  cardCount?: number;
  isActiveTurn?: boolean;
  /** Index 0-4 for avatar colour */
  colorIndex?: number;
  /** Compact row layout: avatar left, labels right (for opponent seats) */
  compact?: boolean;
  /** When true, overlay a blinking white pulse on the avatar to signal surrender */
  surrendered?: boolean;
  /** When true, always use large avatar (w-24 h-24) regardless of screen size */
  fixedSize?: boolean;
  /** When true, show info (role, card count, landlord cards) to the right of avatar instead of below */
  inGame?: boolean;
}

export function PlayerSeat({
  nickname,
  avatarUrl,
  role = 'spectator',
  isLandlord,
  landlordCards,
  cardCount,
  isActiveTurn = false,
  colorIndex = 0,
  compact = false,
  surrendered = false,
  fixedSize = false,
  inGame = false,
}: PlayerSeatProps) {
  const initial = nickname.charAt(0).toUpperCase();
  const avatarColor = AVATAR_COLORS[colorIndex % AVATAR_COLORS.length];

  const avatarSizeClass = fixedSize ? 'w-24 h-24' : 'w-14 h-14 md:w-24 md:h-24';
  const avatarTextClass = fixedSize ? 'text-3xl' : 'text-xl md:text-3xl';

  const avatarImg = avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={avatarUrl}
      alt={nickname}
      className={`${avatarSizeClass} rounded-full object-cover bg-white/10`}
    />
  ) : (
    <div
      className={`${avatarSizeClass} rounded-full flex items-center justify-center text-white font-bold ${avatarTextClass} ${avatarColor}`}
    >
      {initial}
    </div>
  );

  const avatarInner = (
    <div className={`relative ${avatarSizeClass}`}>
      {/* Sweeping conic ring on the active seat — reads as "the clock is running
          on this player" far better than a static highlight does. */}
      {isActiveTurn && (
        <motion.div
          className="absolute -inset-[3px] rounded-full pointer-events-none"
          style={{
            background:
              'conic-gradient(from 0deg, rgba(250,204,21,0) 0deg, rgba(250,204,21,0.95) 70deg, rgba(255,255,255,0.9) 110deg, rgba(250,204,21,0) 200deg, rgba(250,204,21,0) 360deg)',
            // Punch out the middle so only the ring itself shows.
            WebkitMask: 'radial-gradient(circle, transparent 0 calc(50% - 3px), #000 calc(50% - 3px))',
            mask: 'radial-gradient(circle, transparent 0 calc(50% - 3px), #000 calc(50% - 3px))',
          }}
          animate={{ rotate: 360 }}
          transition={{ duration: 2.4, repeat: Infinity, ease: 'linear' }}
        />
      )}
      {avatarImg}
      {surrendered && (
        <motion.div
          className="absolute inset-0 rounded-full bg-white pointer-events-none"
          animate={{ opacity: [0, 0.7, 0] }}
          transition={{ duration: 1.0, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}
    </div>
  );

  const avatarEl = (
    <motion.div
      animate={
        isActiveTurn
          ? {
              boxShadow: [
                '0 0 0px 0px rgba(250,204,21,0)',
                '0 0 12px 6px rgba(250,204,21,0.7)',
                '0 0 0px 0px rgba(250,204,21,0)',
              ],
            }
          : { boxShadow: '0 0 0px 0px rgba(250,204,21,0)' }
      }
      transition={isActiveTurn ? { duration: 1.5, repeat: Infinity, ease: 'easeInOut' } : {}}
      className="rounded-full p-0.5 flex-shrink-0"
    >
      {avatarInner}
    </motion.div>
  );

  if (compact) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.5 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex flex-row items-center gap-2 relative"
      >
        {avatarEl}
        {/* Labels: nickname + role + count stacked */}
        <div className="flex flex-col gap-0.5">
          <span className="text-white text-xs font-medium max-w-[72px] truncate">{nickname}</span>
          {role === 'player' && (
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold w-fit ${
                isLandlord ? 'bg-yellow-400 text-green-900' : 'bg-white/20 text-white'
              }`}
            >
              {isLandlord ? '地主' : '農民'}
            </span>
          )}
          {cardCount !== undefined && role === 'player' && (
            <CardCountBadge count={cardCount} className="w-fit" />
          )}
        </div>

        {/* Landlord bottom-cards */}
        {isLandlord && landlordCards && landlordCards.length > 0 && (
          <LandlordCards cards={landlordCards} />
        )}
      </motion.div>
    );
  }

  if (inGame) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.5 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex flex-row items-center gap-2 relative"
      >
        {/* Turn glow ring */}
        <motion.div
          animate={
            isActiveTurn
              ? {
                  boxShadow: [
                    '0 0 0px 0px rgba(250,204,21,0)',
                    '0 0 12px 6px rgba(250,204,21,0.7)',
                    '0 0 0px 0px rgba(250,204,21,0)',
                  ],
                }
              : { boxShadow: '0 0 0px 0px rgba(250,204,21,0)' }
          }
          transition={isActiveTurn ? { duration: 1.5, repeat: Infinity, ease: 'easeInOut' } : {}}
          className="rounded-full p-0.5 flex-shrink-0"
        >
          {avatarInner}
        </motion.div>

        {/* Info + landlord cards to the right of the avatar */}
        <div className="flex flex-col gap-0.5">
          <span className="text-white text-xs font-medium max-w-[72px] truncate">{nickname}</span>
          {role === 'player' && (
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold w-fit ${
                isLandlord ? 'bg-yellow-400 text-green-900' : 'bg-white/20 text-white'
              }`}
            >
              {isLandlord ? '地主' : '農民'}
            </span>
          )}
          {cardCount !== undefined && role === 'player' && (
            <CardCountBadge count={cardCount} className="w-fit" />
          )}
          {isLandlord && landlordCards && landlordCards.length > 0 && (
            <LandlordCards cards={landlordCards} className="mt-0.5" />
          )}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.5 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex flex-col items-center gap-1 relative"
    >
      <motion.div
        animate={
          isActiveTurn
            ? {
                boxShadow: [
                  '0 0 0px 0px rgba(250,204,21,0)',
                  '0 0 12px 6px rgba(250,204,21,0.7)',
                  '0 0 0px 0px rgba(250,204,21,0)',
                ],
              }
            : { boxShadow: '0 0 0px 0px rgba(250,204,21,0)' }
        }
        transition={isActiveTurn ? { duration: 1.5, repeat: Infinity, ease: 'easeInOut' } : {}}
        className="rounded-full p-0.5"
      >
        {avatarInner}
      </motion.div>

      <span className="text-white text-xs font-medium max-w-[60px] truncate">{nickname}</span>

      {role === 'player' && (
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
            isLandlord ? 'bg-yellow-400 text-green-900' : 'bg-white/20 text-white'
          }`}
        >
          {isLandlord ? '地主' : '農民'}
        </span>
      )}

      {cardCount !== undefined && role === 'player' && <CardCountBadge count={cardCount} />}

      {isLandlord && landlordCards && landlordCards.length > 0 && (
        <LandlordCards cards={landlordCards} className="mt-0.5" />
      )}
    </motion.div>
  );
}
