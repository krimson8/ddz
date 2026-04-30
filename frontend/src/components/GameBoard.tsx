'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CardHand } from './CardHand';
import { Card as CardComponent } from './Card';
import { PlayerSeat } from './PlayerSeat';
import { PlayArea } from './PlayArea';
import { BiddingPanel } from './BiddingPanel';
import { PlayHistory } from './PlayHistory';
import { useSocket } from '@/hooks/useSocket';
import type { Card, ClientMember, GameState } from '@/types/game';

// ── Emoji rate-limit helper ───────────────────────────────────────────────────
const EMOJI_THROTTLE_MS = 500;

interface SeatReaction {
  key: number;
  text: string;
}

const REACTION_GROUPS = [
  { label: '表情', items: ['🖕', '🤏', '🤌'] },
  { label: '語錄', items: ['EZ', 'GG', '什麼lin', '你會玩的嗎', '小癟三', '不用看了', '窩妖驗牌', '牌沒有問題', '在我者離', '給我搽皮鞋'] },
];

interface GameBoardProps {
  gameState: GameState;
  mySocketId: string;
  onPlayCards: (cards: Card[]) => void;
  onPass: () => void;
  onBid: (value: 0 | 1) => void;
  onEmojiReact: (emoji: string) => void;
}

export function GameBoard({
  gameState,
  mySocketId,
  onPlayCards,
  onPass,
  onBid,
  onEmojiReact,
}: GameBoardProps) {
  const {
    members,
    playerOrder,
    myHand,
    currentTurn,
    lastPlay,
    landlordCards,
    landlordIndex,
    phase,
    confirmedVoters,
    playHistory,
    winner,
  } = gameState;

  // Use the server's voteQueue order so indices match currentTurn / landlordIndex.
  const players = playerOrder
    .map((id) => members.find((m) => m.id === id))
    .filter((m): m is typeof members[0] => Boolean(m));
  const myPlayerIndex = playerOrder.indexOf(mySocketId);
  const isMyTurn = myPlayerIndex !== -1 && currentTurn === myPlayerIndex;
  const isSpectator = myPlayerIndex === -1;

  const [winCountdown, setWinCountdown] = useState(5);

  useEffect(() => {
    if (phase !== 'result') return;
    setWinCountdown(5);
    const id = setInterval(() => setWinCountdown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [phase]);

  const lastEmojiTime = useRef(0);
  const [selectedReaction, setSelectedReaction] = useState('🖕');
  const [seatReactions, setSeatReactions] = useState<Record<number, SeatReaction[]>>({});
  const reactionTimers = useRef<Record<number, ReturnType<typeof setTimeout>[]>>({});
  const reactionKeyRef = useRef(0);
  const [selectedCards, setSelectedCards] = useState<Card[]>([]);
  const [hasVotedLandlord, setHasVotedLandlord] = useState(false);

  // Reset landlord vote flag whenever a new bidding round starts
  useEffect(() => {
    if (phase === 'bidding') setHasVotedLandlord(false);
  }, [phase]);

  // Keep latest values accessible inside the socket effect without re-subscribing
  const latestPlayerOrder = useRef(playerOrder);
  latestPlayerOrder.current = playerOrder;
  const latestMyPlayerIndex = useRef(myPlayerIndex);
  latestMyPlayerIndex.current = myPlayerIndex;
  const latestIsSpectator = useRef(isSpectator);
  latestIsSpectator.current = isSpectator;

  const socket = useSocket();

  useEffect(() => {
    const handler = (data: { senderId: string; emoji: string }) => {
      if (latestIsSpectator.current) return;
      const globalIdx = latestPlayerOrder.current.indexOf(data.senderId);
      if (globalIdx === -1) return;
      const key = ++reactionKeyRef.current;
      // Store by globalIdx so reactions follow the player regardless of seat arrangement
      setSeatReactions((prev) => ({
        ...prev,
        [globalIdx]: [...(prev[globalIdx] ?? []), { key, text: data.emoji }],
      }));
      if (!reactionTimers.current[globalIdx]) reactionTimers.current[globalIdx] = [];
      const tid = setTimeout(() => {
        setSeatReactions((prev) => ({
          ...prev,
          [globalIdx]: (prev[globalIdx] ?? []).filter((r) => r.key !== key),
        }));
      }, 3000);
      reactionTimers.current[globalIdx].push(tid);
    };
    socket.on('emoji_reaction', handler);
    return () => { socket.off('emoji_reaction', handler); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket]);

  function handleEmoji() {
    const now = Date.now();
    if (now - lastEmojiTime.current < EMOJI_THROTTLE_MS) return;
    lastEmojiTime.current = now;
    onEmojiReact(selectedReaction);
  }

  // Clockwise seating: local player at bottom, next-in-turn-order at top-left,
  // the one after at top-right. This is consistent for all roles — the landlord
  // will naturally appear wherever they fall in the turn sequence relative to me.
  const orderedPlayers: (ClientMember | null)[] = isSpectator
    ? players
    : [
        players[myPlayerIndex] ?? null,
        players[(myPlayerIndex + 1) % 3] ?? null,
        players[(myPlayerIndex + 2) % 3] ?? null,
      ];

  // Compute who played last for the PlayArea indicator
  const { lastPlayPlayerIndex } = gameState;
  const lastPlayedByName = (() => {
    if (lastPlayPlayerIndex === null) return undefined;
    const id = playerOrder[lastPlayPlayerIndex];
    return members.find((m) => m.id === id)?.nickname;
  })();

  return (
    <div className="relative min-h-screen bg-green-900 flex flex-col select-none overflow-hidden">
      {/* ── Top opponents ───────────────────────────────── */}
      <div className="flex justify-around px-4 pt-4">
        {orderedPlayers.slice(1).map((member) => {
          if (!member) return null;
          const globalIdx = players.indexOf(member);
          return (
            <PlayerSeat
              key={member.id}
              nickname={member.nickname}
              role="player"
              isLandlord={globalIdx === landlordIndex}
              landlordCards={globalIdx === landlordIndex && landlordCards ? landlordCards : undefined}
              cardCount={gameState.playerCardCounts[globalIdx]}
              isActiveTurn={currentTurn === globalIdx}
              colorIndex={globalIdx}
              reactions={seatReactions[globalIdx] ?? []}
              compact
            />
          );
        })}
      </div>

      {/* ── Centre: play area (top 60%) + history strip (bottom 40%) ── */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-[3] flex items-center justify-center px-4 min-h-0">
          {phase === 'bidding' && !isSpectator ? (
            <BiddingPanel
              hasVoted={hasVotedLandlord}
              onVoteYes={() => { setHasVotedLandlord(true); onBid(1); }}
              votedCount={gameState.bidVotedCount}
            />
          ) : (
            <PlayArea lastPlay={lastPlay} playerName={lastPlayedByName} />
          )}
        </div>
        <div className="flex-[2] flex items-end min-h-0">
          <PlayHistory
            history={playHistory}
            playerOrder={playerOrder}
            members={members}
          />
        </div>
      </div>

      {/* ── Bottom: local player hand ──────────────────────── */}
      <motion.div
        className="relative pb-4 pt-2 px-2"
        animate={
          isMyTurn && phase === 'gameplay'
            ? { backgroundColor: ['rgba(0,0,0,0.2)', 'rgba(34,197,94,0.35)', 'rgba(0,0,0,0.2)'] }
            : { backgroundColor: 'rgba(0,0,0,0.2)' }
        }
        transition={
          isMyTurn && phase === 'gameplay'
            ? { duration: 1.2, repeat: Infinity, ease: 'easeInOut' }
            : {}
        }
      >

        {/* Row 1: player seat (left) + emoji selector (right) */}
        <div className="flex items-center justify-between gap-2 mb-1 px-2">
          {orderedPlayers[0] && (
            <PlayerSeat
              nickname={orderedPlayers[0].nickname}
              role="player"
              isLandlord={myPlayerIndex === landlordIndex}
              landlordCards={myPlayerIndex === landlordIndex && landlordCards ? landlordCards : undefined}
              isActiveTurn={isMyTurn}
              colorIndex={myPlayerIndex}
            />
          )}

          {/* Emoji reaction dropdown + send */}
          {!isSpectator && (
            <div className="relative flex items-center gap-2 flex-shrink-0 -mt-3">
              {/* Floating local player reactions */}
              <div className="absolute bottom-full right-0 mb-2 pointer-events-none" style={{ width: 0, height: 0 }}>
                <AnimatePresence>
                  {(seatReactions[myPlayerIndex] ?? []).map((r) => (
                    <motion.div
                      key={r.key}
                      initial={{ opacity: 0, y: 12, scale: 0.85 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -20 }}
                      transition={{ duration: 0.3, ease: 'easeOut' }}
                      className="absolute bottom-0 right-0 whitespace-nowrap bg-black/80 border border-yellow-400/60 text-white text-4xl font-bold px-5 py-3 rounded-xl shadow-xl"
                      style={{ zIndex: r.key }}
                    >
                      {r.text}
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
              <select
                value={selectedReaction}
                onChange={(e) => setSelectedReaction(e.target.value)}
                className="bg-black/60 text-white text-base rounded-lg px-2 py-2 border border-white/20 cursor-pointer focus:outline-none max-w-[140px]"
              >
                {REACTION_GROUPS.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.items.map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <button
                onClick={handleEmoji}
                className="px-3 py-2 rounded-lg bg-yellow-400 hover:bg-yellow-300 active:scale-90 transition-all text-green-900 font-bold text-base min-h-[40px]"
              >
                送出
              </button>
            </div>
          )}
        </div>

        {/* Row 2: selected card preview strip */}
        <div className="overflow-x-auto px-2 mb-1 min-h-[44px] flex items-center" style={{ scrollbarWidth: 'none' }}>
          <AnimatePresence initial={false}>
            {selectedCards.map((card, i) => (
              <motion.div
                key={`preview-${card.suit}-${card.rank}-${i}`}
                initial={{ opacity: 0, y: 10, scale: 0.8 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.6 }}
                transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                className="mr-0.5 flex-shrink-0"
              >
                <CardComponent {...card} mini />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* Hand */}
        {!isSpectator ? (
          <CardHand
            cards={myHand}
            onPlay={onPlayCards}
            onPass={onPass}
            interactive={isMyTurn && phase === 'gameplay'}
            playerIndex={myPlayerIndex}
            lastPlay={lastPlay}
            onSelectionChange={setSelectedCards}
          />
        ) : (
          <p className="text-white/50 text-center text-sm py-4">觀戰中…</p>
        )}
      </motion.div>

      {/* ── Win overlay ──────────────────────────────────────────────────── */}
      <AnimatePresence>
        {phase === 'result' && winner && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/75 flex items-center justify-center z-50"
          >
            <motion.div
              initial={{ scale: 0.7, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 280, damping: 22 }}
              className="bg-green-900/95 rounded-2xl p-8 w-full max-w-sm flex flex-col items-center gap-6 border border-yellow-400/30 shadow-2xl mx-4"
            >
              <div className="text-center">
                <motion.div
                  initial={{ y: -20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.2 }}
                  className="text-5xl mb-2"
                >
                  {winner === 'landlord' ? '🏆' : '🎉'}
                </motion.div>
                <h2 className="text-2xl font-black text-white">
                  {winner === 'landlord' ? '地主獲勝！' : '農民獲勝！'}
                </h2>
                <motion.p
                  key={winCountdown}
                  initial={{ opacity: 0, scale: 1.3 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="text-yellow-300 text-sm font-bold mt-1 tabular-nums"
                >
                  {winCountdown > 0 ? `${winCountdown} 秒後返回大廳…` : '返回大廳…'}
                </motion.p>
              </div>
              <div className="flex gap-4 flex-wrap justify-center">
                {players.map((member, globalIdx) => {
                  if (!member) return null;
                  const isWinner = winner === 'landlord'
                    ? globalIdx === landlordIndex
                    : globalIdx !== landlordIndex;
                  const colors = ['bg-blue-500', 'bg-purple-500', 'bg-pink-500'];
                  return (
                    <motion.div
                      key={member.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.3 + globalIdx * 0.1 }}
                      className="flex flex-col items-center gap-1"
                    >
                      <div
                        className={`w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg ${colors[globalIdx % colors.length]} ${isWinner ? 'ring-2 ring-yellow-400' : 'opacity-60'}`}
                      >
                        {member.nickname.charAt(0).toUpperCase()}
                      </div>
                      <span className="text-white text-xs">{member.nickname}</span>
                      {isWinner && <span className="text-yellow-400 text-xs font-bold">勝利</span>}
                    </motion.div>
                  );
                })}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
