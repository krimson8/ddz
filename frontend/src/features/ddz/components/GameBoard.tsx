'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CardHand } from './CardHand';
import { Card as CardComponent } from './Card';
import { PlayerSeat } from './PlayerSeat';
import { PlayArea } from './PlayArea';
import { BiddingPanel } from './BiddingPanel';
import { RoleDrawPanel } from './RoleDrawPanel';
import { PlayHistory } from './PlayHistory';
import { EmojiChatBox, type EmojiHistoryEntry } from '@/components/EmojiChatBox';
import { useSocket } from '@/hooks/useSocket';
import type { Card, ClientMember, GameState } from '@/features/ddz/types';

interface SeatReaction {
  key: number;
  text: string;
}

const EMOJI_HISTORY_LIMIT = 5;

/** Pure render of remaining grace seconds — backend owns the truth (endTime). */
function DisconnectCountdown({ endTime }: { endTime: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const secondsLeft = Math.max(0, Math.ceil((endTime - now) / 1000));
  return (
    <div className="text-5xl font-black text-yellow-400 tabular-nums drop-shadow">
      {secondsLeft}
    </div>
  );
}

const REACTION_GROUPS = [
  { label: '表情', items: ['🖕', '🤏', '🤌'] },
  { label: '語錄', items: ['EZ', 'GG', '你會玩的嗎', '玩不了啦', '小兒科', '小癟三', '不用看了', '在我者離', '窩妖驗牌', '牌沒有問題', '給我搽皮鞋'] },
];

interface GameBoardProps {
  gameState: GameState;
  mySocketId: string;
  onPlayCards: (cards: Card[]) => void;
  onPass: () => void;
  onBid: (value: 0 | 1) => void;
  onPickRole: (slotIndex: number) => void;
  onRevealRoleForFun: (slotIndex: number) => void;
  onSurrender: () => void;
  onEmojiReact: (emoji: string) => void;
  onEmojiReceived?: (emoji: string) => void;
}

export function GameBoard({
  gameState,
  mySocketId,
  onPlayCards,
  onPass,
  onBid,
  onPickRole,
  onRevealRoleForFun,
  onSurrender,
  onEmojiReact,
  onEmojiReceived,
}: GameBoardProps) {
  const {
    members,
    playerOrder,
    myHand,
    currentPlayer,
    currentPlayerEndTime,
    lastPlay,
    landlordCards,
    playerHands,
    landlordIndex,
    phase,
    roleSlots,
    roleSubmitted,
    roleLocked,
    playHistory,
    winner,
    winReason,
    surrendered,
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
  const [emojiHistory, setEmojiHistory] = useState<EmojiHistoryEntry[]>([]);
  const [seatReactions, setSeatReactions] = useState<Record<number, SeatReaction[]>>({});
  const reactionTimers = useRef<Record<number, ReturnType<typeof setTimeout>[]>>({});
  const reactionKeyRef = useRef(0);
  const [selectedCards, setSelectedCards] = useState<Card[]>([]);

  const amLandlord = !isSpectator && myPlayerIndex !== -1 && myPlayerIndex === landlordIndex;
  const iSurrendered = !isSpectator && myPlayerIndex !== -1 && surrendered.includes(myPlayerIndex);

  // Spectator: which player index (in playerOrder) is shown at the bottom seat.
  // Defaults to landlordIndex once known, otherwise 0.
  const defaultSpectatorView = landlordIndex !== null && landlordIndex >= 0 ? landlordIndex : 0;
  const [spectatorViewIndex, setSpectatorViewIndex] = useState<number>(defaultSpectatorView);

  // When the landlord is decided, snap the spectator view to the landlord.
  const prevLandlordIndex = useRef<number | null>(null);
  useEffect(() => {
    if (isSpectator && landlordIndex !== null && landlordIndex >= 0 && landlordIndex !== prevLandlordIndex.current) {
      setSpectatorViewIndex(landlordIndex);
      prevLandlordIndex.current = landlordIndex;
    }
  }, [isSpectator, landlordIndex]);

  // Keep latest values accessible inside the socket effect without re-subscribing
  const latestPlayerOrder = useRef(playerOrder);
  latestPlayerOrder.current = playerOrder;

  const socket = useSocket("ddz");

  const latestOnEmojiReceived = useRef(onEmojiReceived);
  latestOnEmojiReceived.current = onEmojiReceived;

  useEffect(() => {
    const handler = (data: { senderId: string; senderNickname?: string; emoji: string }) => {
      latestOnEmojiReceived.current?.(data.emoji);
      const histKey = ++reactionKeyRef.current;
      setEmojiHistory((prev) => [
        ...prev.slice(-(EMOJI_HISTORY_LIMIT - 1)),
        { key: histKey, nickname: data.senderNickname ?? '玩家', emoji: data.emoji },
      ]);
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

  // Players seated: [0] = bottom, [1] = top-left, [2] = top-right (clockwise).
  // Players: local player bottom, next clockwise top-left, then top-right.
  // Spectators: spectatorViewIndex bottom, next two clockwise at top.
  const orderedPlayers: (ClientMember | null)[] = (() => {
    if (!isSpectator) {
      return [
        players[myPlayerIndex] ?? null,
        players[(myPlayerIndex + 1) % 3] ?? null,
        players[(myPlayerIndex + 2) % 3] ?? null,
      ];
    }
    if (players.length < 3) {
      return [players[0] ?? null, players[1] ?? null, players[2] ?? null];
    }
    return [
      players[spectatorViewIndex] ?? null,
      players[(spectatorViewIndex + 1) % 3] ?? null,
      players[(spectatorViewIndex + 2) % 3] ?? null,
    ];
  })();

  // Compute who played last for the PlayArea indicator
  const { lastPlayedBy } = gameState;
  const lastPlayedByName = lastPlayedBy
    ? members.find((m) => m.id === lastPlayedBy)?.nickname
    : undefined;

  return (
    <div className="relative min-h-screen bg-green-900 flex flex-col select-none overflow-hidden h-screen">
      {/* ── Top opponents ───────────────────────────────── */}
      {/* pr-16 on mobile keeps the top-right seat/landlord cards clear of the fixed volume button */}
      <div className="flex justify-around px-4 pr-16 sm:pr-4 pt-4">
        {orderedPlayers.slice(1).map((member) => {
          if (!member) return null;
          const globalIdx = players.indexOf(member);
          return (
            <div
              key={member.id}
              onClick={isSpectator ? () => setSpectatorViewIndex(globalIdx) : undefined}
              className={isSpectator ? 'cursor-pointer' : undefined}
            >
              <PlayerSeat
                nickname={member.nickname}
                avatarUrl={member.avatarUrl}
                role="player"
                isLandlord={globalIdx === landlordIndex}
                landlordCards={globalIdx === landlordIndex && landlordCards ? landlordCards : undefined}
                cardCount={gameState.playerCardCounts[globalIdx]}
                isActiveTurn={currentPlayer === member.id}
                colorIndex={globalIdx}
                reactions={seatReactions[globalIdx] ?? []}
                surrendered={surrendered.includes(globalIdx)}
                compact
              />
            </div>
          );
        })}
      </div>

      {/* ── Centre: play area (top 60%) + history strip (bottom 40%) ── */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="relative flex-[2] flex items-center justify-center px-4 min-h-0">
          {/* Emoji chatbox — bottom-right of the play area, overlays the central cards */}
          <EmojiChatBox
            className="absolute bottom-2 right-2 z-30"
            history={emojiHistory}
            groups={REACTION_GROUPS}
            selected={selectedReaction}
            onSelect={setSelectedReaction}
            onSend={handleEmoji}
          />
          {phase === 'bidding' && !isSpectator ? (
            <BiddingPanel
              hasVoted={gameState.bidSubmitted}
              onVoteYes={() => onBid(1)}
              votedCount={gameState.bidVotedCount}
              timeoutMs={gameState.bidTimeoutMs}
            />
          ) : phase === 'roledraw' && !isSpectator ? (
            <RoleDrawPanel
              slots={roleSlots}
              hasPicked={roleSubmitted}
              locked={roleLocked}
              myPlayerIndex={myPlayerIndex}
              playerNames={players.map((p) => p?.nickname)}
              onPick={onPickRole}
              onRevealForFun={onRevealRoleForFun}
            />
          ) : (
            <PlayArea lastPlay={lastPlay} playerName={lastPlayedByName} />
          )}
        </div>
        <div className="flex-[1] flex items-end min-h-0">
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
          /* Spectator bottom: viewed player seat + their hand (click top seats to swap) */
          <div className="flex flex-col gap-1 px-2 py-2">
            <div className="flex items-center justify-between gap-2">
              <PlayerSeat
                nickname={orderedPlayers[0]?.nickname ?? ''}
                avatarUrl={orderedPlayers[0]?.avatarUrl ?? null}
                role="player"
                isLandlord={spectatorViewIndex === landlordIndex}
                landlordCards={spectatorViewIndex === landlordIndex && landlordCards ? landlordCards : undefined}
                cardCount={gameState.playerCardCounts[spectatorViewIndex]}
                isActiveTurn={currentPlayer === orderedPlayers[0]?.id}
                colorIndex={spectatorViewIndex}
                reactions={seatReactions[spectatorViewIndex] ?? []}
                surrendered={surrendered.includes(spectatorViewIndex)}
                inGame
              />
              <p className="text-white/40 text-xs italic ml-2">觀戰中</p>
            </div>
            {playerHands[spectatorViewIndex] && playerHands[spectatorViewIndex].length > 0 && (
              <CardHand
                cards={playerHands[spectatorViewIndex]}
                onPlay={() => {}}
                onPass={() => {}}
                interactive={false}
                playerIndex={spectatorViewIndex}
                lastPlay={null}
                onSelectionChange={() => {}}
                turnEndTime={null}
                showActions={false}
              />
            )}
          </div>
        ) : (
          <>
            {/* Row 1: player seat (left) + emoji selector (right) */}
            <div className="flex items-center justify-between gap-2 mb-1 px-2">
              <div className="flex items-end gap-2">
                {orderedPlayers[0] && (
                  <PlayerSeat
                    nickname={orderedPlayers[0].nickname}
                    avatarUrl={orderedPlayers[0].avatarUrl}
                    role="player"
                    isLandlord={myPlayerIndex === landlordIndex}
                    landlordCards={myPlayerIndex === landlordIndex && landlordCards ? landlordCards : undefined}
                    isActiveTurn={isMyTurn}
                    colorIndex={myPlayerIndex}
                    surrendered={iSurrendered}
                    inGame
                  />
                )}
                {phase === 'gameplay' && (
                  <button
                    onClick={onSurrender}
                    className={[
                      'text-[11px] font-bold px-2 py-1 rounded-md border transition-colors min-h-[28px] whitespace-nowrap',
                      amLandlord && iSurrendered
                        ? 'bg-red-500 hover:bg-red-400 text-white border-red-300 animate-pulse'
                        : iSurrendered
                          ? 'bg-yellow-400 text-green-900 border-yellow-300'
                          : 'bg-black/50 hover:bg-black/70 text-white/80 hover:text-white border-white/20',
                    ].join(' ')}
                    title={amLandlord ? '地主投降輸一半（連按兩次確認）' : '投降輸一半（兩位農民同時投降輸一半即敗）'}
                  >
                    {amLandlord
                      ? (iSurrendered ? '確定投降輸一半？' : '投降輸一半')
                      : (iSurrendered ? '✓ 已投降輸一半' : '投降輸一半')}
                  </button>
                )}
              </div>

              {/* Floating local player reactions (emoji picker now lives in the chatbox) */}
              <div className="relative flex-shrink-0">
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
              <DisconnectCountdown endTime={disconnectedPlayer.endTime} />
              <p className="text-white/70 text-sm">等待重連中，若逾時遊戲將中止</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Win banner (inline, does not block the board) ───────────────── */}
      <AnimatePresence>
        {phase === 'result' && winner && (
          <motion.div
            initial={{ opacity: 0, y: -40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -40 }}
            transition={{ type: 'spring', stiffness: 260, damping: 22 }}
            className="absolute top-0 left-0 right-0 z-50 flex flex-col items-center gap-2 px-4 pt-3 pb-4 bg-gradient-to-b from-black/80 to-transparent pointer-events-none"
          >
            {/* Announcement row */}
            <div className="flex items-center gap-3">
              <span className="text-3xl">{winner === 'landlord' ? '🏆' : '🎉'}</span>
              <h2 className="text-2xl font-black text-white drop-shadow-lg">
                {winReason === 'surrender'
                  ? (winner === 'landlord' ? '農民投降輸一半！' : '地主投降輸一半！')
                  : (winner === 'landlord' ? '地主獲勝！' : '農民獲勝！')}
              </h2>
            </div>

            {/* Winner names */}
            <div className="flex gap-2 flex-wrap justify-center">
              {players.map((member, globalIdx) => {
                if (!member) return null;
                const isWinner = gameState.winnerIds.includes(playerOrder[globalIdx]);
                const colors = ['bg-blue-500', 'bg-purple-500', 'bg-pink-500'];
                return (
                  <span
                    key={member.id}
                    className={`text-xs font-bold px-2 py-0.5 rounded-full ${isWinner ? `${colors[globalIdx % colors.length]} text-white ring-1 ring-yellow-400` : 'text-white/40'}`}
                  >
                    {isWinner ? '✓ ' : ''}{member.nickname}
                  </span>
                );
              })}
            </div>

            {/* Winning hand cards */}
            {gameState.winningCards.length > 0 && (
              <div className="flex gap-1 flex-wrap justify-center mt-1">
                {gameState.winningCards.map((card, i) => (
                  <CardComponent key={`win-${card.suit}-${card.rank}-${i}`} {...card} mini />
                ))}
              </div>
            )}

            <p className="text-yellow-300 text-xs font-bold mt-1 animate-pulse">返回大廳中…</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
