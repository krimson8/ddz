'use client';

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
            <span className="bg-black/40 text-white text-[10px] px-1.5 py-0.5 rounded-full w-fit">
              {cardCount}張
            </span>
          )}
        </div>

        {/* Landlord bottom-cards */}
        {isLandlord && landlordCards && landlordCards.length > 0 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex gap-0.5"
          >
            {landlordCards.map((card, i) => (
              <Card key={i} {...card} mini />
            ))}
          </motion.div>
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
            <span className="bg-black/40 text-white text-[10px] px-1.5 py-0.5 rounded-full w-fit">
              {cardCount}張
            </span>
          )}
          {isLandlord && landlordCards && landlordCards.length > 0 && (
            <motion.div
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex gap-0.5 mt-0.5"
            >
              {landlordCards.map((card, i) => (
                <Card key={i} {...card} mini />
              ))}
            </motion.div>
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

      {cardCount !== undefined && role === 'player' && (
        <span className="bg-black/40 text-white text-[10px] px-1.5 py-0.5 rounded-full">
          {cardCount}張
        </span>
      )}

      {isLandlord && landlordCards && landlordCards.length > 0 && (
        <motion.div
          initial={{ opacity: 0, scale: 0.7 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex gap-0.5 mt-0.5"
        >
          {landlordCards.map((card, i) => (
            <Card key={i} {...card} mini />
          ))}
        </motion.div>
      )}
    </motion.div>
  );
}
