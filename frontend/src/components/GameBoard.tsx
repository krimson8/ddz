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
    currentPlayer,
    currentPlayerEndTime,
    lastPlay,
    landlordCards,
    landlordIndex,
    phase,
    playHistory,
    winner,
    disconnectedPlayer,
  } = gameState;

  // Use the server's playerIds order so indices match landlordIndex.
  const players = playerOrder
    .map((id) => members.find((m) => m.id === id))
    .filter((m): m is typeof members[0] => Boolean(m));
  const myPlayerIndex = playerOrder.indexOf(mySocketId);
  const isMyTurn = currentPlayer === mySocketId;
  const isSpectator = myPlayerIndex === -1;


  const [selectedReaction, setSelectedReaction] = useState('🖕');
  const [seatReactions, setSeatReactions] = useState<Record<number, SeatReaction[]>>({});
  const reactionTimers = useRef<Record<number, ReturnType<typeof setTimeout>[]>>({});
  const reactionKeyRef = useRef(0);
  const [selectedCards, setSelectedCards] = useState<Card[]>([]);

  // Keep latest values accessible inside the socket effect without re-subscribing
  const latestPlayerOrder = useRef(playerOrder);
  latestPlayerOrder.current = playerOrder;

  const socket = useSocket();

  useEffect(() => {
    const handler = (data: { senderId: string; emoji: string }) => {
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
    onEmojiReact(selectedReaction);
  }

  // Players seated: [0] = bottom, [1] = top-left, [2] = top-right.
  // Players: local player bottom, next clockwise top-left, then top-right.
  // Spectators: landlord bottom (once known), peasants at top.
  const orderedPlayers: (ClientMember | null)[] = (() => {
    if (!isSpectator) {
      return [
        players[myPlayerIndex] ?? null,
        players[(myPlayerIndex + 1) % 3] ?? null,
        players[(myPlayerIndex + 2) % 3] ?? null,
      ];
    }
    if (landlordIndex === null || landlordIndex < 0 || players.length < 3) {
      return [players[0] ?? null, players[1] ?? null, players[2] ?? null];
    }
    const p0 = players[landlordIndex];
    const p1 = players[(landlordIndex + 1) % 3];
    const p2 = players[(landlordIndex + 2) % 3];
    return [p0 ?? null, p1 ?? null, p2 ?? null];
  })();

  // Compute who played last for the PlayArea indicator
  const { lastPlayedBy } = gameState;
  const lastPlayedByName = lastPlayedBy
    ? members.find((m) => m.id === lastPlayedBy)?.nickname
    : undefined;

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
              isActiveTurn={currentPlayer === member.id}
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
              hasVoted={gameState.bidSubmitted}
              onVoteYes={() => onBid(1)}
              votedCount={gameState.bidVotedCount}
              timeoutMs={gameState.bidTimeoutMs}
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

      {/* ── Bottom: local player hand or spectator landlord seat ─────── */}
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
        {isSpectator ? (
          /* Spectator bottom: landlord seat (or first player before landlord decided) */
          <div className="flex items-center justify-between gap-2 px-2 py-2">
            {orderedPlayers[0] && (() => {
              const globalIdx = players.indexOf(orderedPlayers[0]!);
              return (
                <PlayerSeat
                  nickname={orderedPlayers[0].nickname}
                  role="player"
                  isLandlord={globalIdx === landlordIndex}
                  landlordCards={globalIdx === landlordIndex && landlordCards ? landlordCards : undefined}
                  cardCount={gameState.playerCardCounts[globalIdx]}
                  isActiveTurn={currentPlayer === orderedPlayers[0]!.id}
                  colorIndex={globalIdx}
                  reactions={seatReactions[globalIdx] ?? []}
                />
              );
            })()}
            <p className="text-white/40 text-xs italic ml-2">觀戰中</p>
          </div>
        ) : (
          <>
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
            <CardHand
              cards={myHand}
              onPlay={onPlayCards}
              onPass={onPass}
              interactive={isMyTurn && phase === 'gameplay'}
              playerIndex={myPlayerIndex}
              lastPlay={lastPlay}
              onSelectionChange={setSelectedCards}
              turnEndTime={isMyTurn ? currentPlayerEndTime : null}
            />
          </>
        )}
      </motion.div>

      {/* ── Disconnect overlay ───────────────────────────────────────────── */}
      <AnimatePresence>
        {disconnectedPlayer && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/70 flex items-center justify-center z-40"
          >
            <motion.div
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 280, damping: 22 }}
              className="bg-green-900/95 rounded-2xl p-8 w-full max-w-xs flex flex-col items-center gap-4 border border-yellow-400/30 shadow-2xl mx-4 text-center"
            >
              <div className="text-4xl">⏳</div>
              <h2 className="text-xl font-black text-white">{disconnectedPlayer.nickname} 斷線了</h2>
              <p className="text-white/70 text-sm">等待重連中，若逾時遊戲將中止</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
                <p className="text-yellow-300 text-sm font-bold mt-1">返回大廳中…</p>
              </div>
              <div className="flex gap-4 flex-wrap justify-center">
                {players.map((member, globalIdx) => {
                  if (!member) return null;
                  const isWinner = gameState.winnerIds.includes(playerOrder[globalIdx]);
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
