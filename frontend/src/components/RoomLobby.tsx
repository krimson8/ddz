'use client';

import { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { PlayerSeat } from './PlayerSeat';
import { useSocket } from '@/hooks/useSocket';
import { useLeaderboard } from '@/hooks/useLeaderboard';
import type { ClientMember } from '@/types/game';

const NEON_COLORS = [
  '#ff0080', '#ff4400', '#ffcc00', '#00ff88', '#00ccff', '#aa00ff', '#ff00cc',
];

function useRainbowColor() {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setIndex((i) => (i + 1) % NEON_COLORS.length), 180);
    return () => clearInterval(id);
  }, []);
  return NEON_COLORS[index];
}

const ORBIT_EMOJIS = ['🔥', '💥', '🀄', '⚡', '🎰', '🤑'];

function OrbitEmoji({ emoji, index }: { emoji: string; index: number }) {
  const angle = (index / ORBIT_EMOJIS.length) * 360;
  const delay = index * 0.15;
  return (
    <motion.span
      style={{
        position: 'absolute',
        fontSize: '1.4rem',
        pointerEvents: 'none',
        originX: '50%',
        originY: '50%',
      }}
      animate={{
        rotate: [angle, angle + 360],
        x: [
          Math.cos((angle * Math.PI) / 180) * 54,
          Math.cos(((angle + 180) * Math.PI) / 180) * 54,
          Math.cos(((angle + 360) * Math.PI) / 180) * 54,
        ],
        y: [
          Math.sin((angle * Math.PI) / 180) * 54,
          Math.sin(((angle + 180) * Math.PI) / 180) * 54,
          Math.sin(((angle + 360) * Math.PI) / 180) * 54,
        ],
        scale: [1, 1.4, 1],
      }}
      transition={{
        duration: 2.2,
        repeat: Infinity,
        ease: 'linear',
        delay,
      }}
    >
      {emoji}
    </motion.span>
  );
}

interface RoomLobbyProps {
  roomCode: string;
  members: ClientMember[];
  myNickname?: string;
  myUid: string;
  onVote: () => void;
  hasVoted: boolean;
}

export function RoomLobby({
  roomCode,
  members,
  myUid,
  onVote,
  hasVoted,
}: RoomLobbyProps) {
  const [clicked, setClicked] = useState(false);
  const rainbowColor = useRainbowColor();
  const socket = useSocket();
  const { entries: leaderboard, loading: leaderboardLoading } = useLeaderboard(socket);

  function handleVote() {
    if (hasVoted) return;
    setClicked(true);
    setTimeout(() => setClicked(false), 400);
    onVote();
  }

  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-md mx-auto px-4">

      {/* Room code inline title */}
      <p className="text-white/50 text-sm tracking-wide">
        房間：<span className="text-yellow-400 font-bold">{roomCode}</span>
      </p>

      {/* Vote button */}
      <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
        {!hasVoted && ORBIT_EMOJIS.map((emoji, i) => (
          <OrbitEmoji key={i} emoji={emoji} index={i} />
        ))}
        {hasVoted ? (
          <div className="px-8 py-3 rounded-xl font-bold text-lg bg-green-600 text-white min-h-[44px] flex items-center select-none opacity-80 cursor-not-allowed">
            ✅ 已準備！
          </div>
        ) : (
          <motion.button
            onClick={handleVote}
            style={{
              backgroundColor: rainbowColor,
              boxShadow: `0 0 24px 6px ${rainbowColor}99, 0 0 60px 12px ${rainbowColor}44`,
              color: '#fff',
              fontWeight: 900,
              fontSize: '1.25rem',
              letterSpacing: '0.05em',
              padding: '12px 36px',
              borderRadius: '14px',
              border: 'none',
              cursor: 'pointer',
              position: 'relative',
              zIndex: 1,
              textShadow: '0 1px 4px rgba(0,0,0,0.6)',
              minHeight: '44px',
              userSelect: 'none',
            }}
            animate={
              clicked
                ? { scale: [1, 1.35, 0.9, 1.1, 1] }
                : {
                    scale: [1, 1.07, 1, 1.07, 1],
                    rotate: [0, -3, 3, -2, 2, -1, 1, 0],
                  }
            }
            transition={
              clicked
                ? { duration: 0.35, ease: 'easeOut' }
                : {
                    scale: { duration: 1.4, repeat: Infinity, ease: 'easeInOut' },
                    rotate: { duration: 0.55, repeat: Infinity, repeatDelay: 2.5, ease: 'easeInOut' },
                  }
            }
          >
            🎮 我要玩！
          </motion.button>
        )}
      </div>

      {/* Member strip */}
      <div className="flex gap-4 flex-wrap justify-center">
        <AnimatePresence>
          {members.map((member, i) => {
            const isMe = member.id === myUid;
            const isReady = member.wantToPlay;
            return (
              <div
                key={member.id}
                className={[
                  'rounded-2xl transition-all duration-300 p-1',
                  isReady && isMe
                    ? 'ring-4 ring-yellow-400 shadow-[0_0_18px_4px_rgba(250,204,21,0.6)]'
                    : isReady
                      ? 'ring-2 ring-green-400 shadow-[0_0_12px_2px_rgba(74,222,128,0.5)]'
                      : '',
                ].join(' ')}
              >
                <PlayerSeat
                  nickname={member.nickname}
                  avatarUrl={member.avatarUrl}
                  role={member.role}
                  colorIndex={i}
                  fixedSize
                />
              </div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Global leaderboard */}
      <div className="w-full">
        <p className="text-white/60 text-xs text-center mb-2">🏆 全球排行榜</p>
        {leaderboardLoading ? (
          <p className="text-white/40 text-xs text-center">載入中…</p>
        ) : leaderboard.length === 0 ? (
          <p className="text-white/40 text-xs text-center">尚無比賽記錄</p>
        ) : (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 px-3 py-1 text-white/50 text-[10px] uppercase tracking-wider">
              <span className="w-6 text-right">#</span>
              <span className="flex-1">玩家</span>
              <span className="w-10 text-right">總勝</span>
              <span className="w-8 text-right" title="地主勝">地</span>
              <span className="w-8 text-right" title="農民勝">農</span>
              <span className="w-10 text-right">場次</span>
            </div>
            {leaderboard.slice(0, 10).map((entry, i) => (
              <div
                key={entry.uid}
                className="flex items-center gap-2 bg-white/10 rounded-lg px-3 py-1.5 text-sm"
              >
                <span className="w-6 text-right text-white/60">{i + 1}</span>
                <span className="flex-1 flex items-center gap-2 min-w-0">
                  {entry.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={entry.avatarUrl}
                      alt={entry.nickname}
                      className="w-12 h-12 rounded-full object-cover bg-white/10 flex-shrink-0"
                    />
                  ) : (
                    <span className="w-12 h-12 rounded-full bg-yellow-400 text-green-900 text-base font-bold flex items-center justify-center flex-shrink-0">
                      {entry.nickname.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <span className="text-white truncate">{entry.nickname}</span>
                </span>
                <span className="w-10 text-right text-yellow-400 font-bold">{entry.totalWins}</span>
                <span className="w-8 text-right text-red-300">{entry.landlordWins}</span>
                <span className="w-8 text-right text-green-300">{entry.farmerWins}</span>
                <span className="w-10 text-right text-white/50">{entry.games}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
