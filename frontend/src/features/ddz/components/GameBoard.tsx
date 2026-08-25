'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useAnimationControls, useReducedMotion } from 'framer-motion';
import { CardHand } from './CardHand';
import { Card as CardComponent } from './Card';
import { PlayerSeat } from './PlayerSeat';
import { PlayArea, type PlayOrigin } from './PlayArea';
import { BiddingPanel } from './BiddingPanel';
import { RoleDrawPanel } from './RoleDrawPanel';
import { PlayHistory } from './PlayHistory';
import { DealingOverlay } from './effects/DealingOverlay';
import { shakeLevel, type ShakeStrength } from './effects/HitBanner';
import type { Knock } from '@/features/ddz/useHitEvents';
import { FLIGHT_IMPACT_MS } from '@/features/ddz/cardFlight';
import { EmojiChatBox, type EmojiHistoryEntry } from '@/components/EmojiChatBox';
import type { Card, ClientMember, GameState } from '@/features/ddz/types';

/**
 * How long a played card takes to reach the table, ms.
 *
 * Taken from the flight itself rather than guessed, so the jolt lands on the
 * frame the card hits the felt.
 */
const LAND_MS = FLIGHT_IMPACT_MS;

/**
 * Board shake, seven strengths.
 *
 * One decaying-oscillation profile scaled by amplitude, rather than seven
 * hand-written keyframe sets. The strengths have to be comparable to each other
 * — that is the whole point of a ladder — and hand-tuning each rung
 * independently is how they drift apart. Shared with the fx-lab preview, which
 * runs the identical numbers through CSS.
 */
const SHAKE_TIMES = [0, 0.04, 0.09, 0.15, 0.22, 0.3, 0.39, 0.49, 0.6, 0.71, 0.82, 0.92, 1];
const SHAKE_X = [0, -1, 0.91, -0.79, 0.65, -0.53, 0.41, -0.29, 0.24, -0.15, 0.09, -0.06, 0];
const SHAKE_Y = [0, 0.65, -0.76, -0.47, 0.59, -0.38, 0.29, -0.24, 0.18, -0.12, 0.06, -0.03, 0];
const SHAKE_R = [0, -1, 0.9, -0.71, 0.55, -0.4, 0.29, -0.2, 0.14, -0.09, 0.05, -0.02, 0];
const SHAKE_S = [0, 1, 0.84, 0.68, 0.52, 0.36, 0.24, 0.16, 0.1, 0, 0, 0, 0];

/** Amplitude in px, rotation in deg, scale bump, and length in seconds. */
const SHAKE: Record<ShakeStrength, { x: number; r: number; z: number; d: number }> = {
  1: { x: 6, r: 0.35, z: 0, d: 0.42 },
  2: { x: 11, r: 0.6, z: 0.004, d: 0.56 },
  3: { x: 17, r: 0.95, z: 0.01, d: 0.72 },
  4: { x: 24, r: 1.35, z: 0.018, d: 0.9 },
  5: { x: 32, r: 1.8, z: 0.028, d: 1.12 },
  6: { x: 42, r: 2.3, z: 0.04, d: 1.4 },
  7: { x: 54, r: 2.9, z: 0.055, d: 1.75 },
};

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
  /** Send an emoji reaction (owned by the page-level emoji chat hook). */
  onReactEmoji: (emoji: string) => void;
  /** Recent emoji history shared across the lobby and game (page-owned). */
  emojiHistory: EmojiHistoryEntry[];
  selectedReaction: string;
  onSelectReaction: (value: string) => void;
  /** Leave the room and return to the lobby (shown to spectators). */
  onLeave: () => void;
  /**
   * The jolts the newest play earns.
   *
   * The banner that schedules these is mounted at page level, above this
   * component: the server resets the room — unmounting the board — while a
   * banner or a finale may still be playing. The table is the one part of it
   * that has to live here, so the schedule is passed down instead.
   */
  knock: Knock | null;
  /** Hold the played cards back while a cold open has the screen. */
  holdTable: boolean;
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
  onReactEmoji,
  emojiHistory,
  selectedReaction,
  onSelectReaction,
  onLeave,
  knock,
  holdTable,
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

  function handleEmoji() {
    onReactEmoji(selectedReaction);
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

  // Which seat the cards should fly in from. 'self' is the seat shown at the
  // bottom, whose cards are measured out of the real hand rather than launched
  // from a synthesised off-screen point.
  const playOrigin: PlayOrigin = !lastPlayedBy
    ? null
    : lastPlayedBy === orderedPlayers[0]?.id
      ? 'self'
      : lastPlayedBy === orderedPlayers[1]?.id
        ? 'left'
        : lastPlayedBy === orderedPlayers[2]?.id
          ? 'right'
          : null;

  /**
   * What the table shows, which is not always the newest play.
   *
   * 火箭 and 天堂製造 open cold — a line from the player's seat over a cue,
   * with the table still — so their cards must not come flying out from under
   * the dialog. The table clears for it and stays bare until the line is over.
   *
   * Bare, rather than holding the play being beaten: PlayArea re-aims its
   * flight whenever the play or the seat it came from changes, so *any*
   * substitute play risks flying the old cards in a second time. A null play is
   * the one value that cannot launch a flight at all, which makes the hold
   * structurally incapable of the thing it is there to prevent.
   */
  const table = holdTable
    ? { play: null, name: undefined, origin: null }
    : { play: lastPlay, name: lastPlayedByName, origin: playOrigin };

  // ── Hit banners ───────────────────────────────────────────────────────────
  // The table's share of a hit: everything visual is drawn a level up.
  const shake = useAnimationControls();
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!knock || reduceMotion) return;

    const jolt = (strength: ShakeStrength) => {
      const s = SHAKE[strength];
      shake.start({
        x: SHAKE_X.map((f) => f * s.x),
        y: SHAKE_Y.map((f) => f * s.x),
        rotate: SHAKE_R.map((f) => f * s.r),
        scale: SHAKE_S.map((f) => 1 + f * s.z),
        // The profile above already carries the decay, so the easing only has
        // to shape each individual swing.
        transition: { duration: s.d, times: SHAKE_TIMES, ease: [0.33, 0.05, 0.2, 0.98] },
      });
    };

    const strength = shakeLevel(knock.level);
    const timers: ReturnType<typeof setTimeout>[] = [];

    // The heavy tiers wind up before they hit, so the big jolt waits for the
    // impact. When that wait is long enough to read as a separate beat, the
    // card still gets its own small knock as it lands — otherwise the two would
    // collide and the light one would cut the heavy one short.
    const hitAt = Math.max(LAND_MS, knock.impactAt);
    if (strength > 1 && knock.impactAt > LAND_MS + 300) timers.push(setTimeout(() => jolt(1), LAND_MS));

    if (knock.beats.length) {
      // Tier 5 and up land one glyph at a time and go off again at the end.
      // The banner already worked out when each of those happens, so the table
      // follows its schedule rather than keeping a second one of its own.
      for (const beat of knock.beats) timers.push(setTimeout(() => jolt(beat.strength), beat.at));
    } else {
      timers.push(setTimeout(() => jolt(strength), hitAt));
      // A blast and up rings twice: the hit, then the room settling.
      if (strength >= 5) {
        const after = Math.ceil(strength / 2) as ShakeStrength;
        timers.push(setTimeout(() => jolt(after), hitAt + 950));
      }
    }

    return () => timers.forEach(clearTimeout);
  }, [knock, shake, reduceMotion]);

  return (
    <div className="relative min-h-screen ddz-felt ddz-scene flex flex-col select-none overflow-hidden h-screen">
      {/* Draggable emoji chatbox — fixed + highest z so the player can move it
          anywhere on screen and it always sits above the board. Mounted at the
          board root (not inside the centre play area) so reflows there — e.g. a
          card being played — never shift framer-motion's measured drag origin. */}
      <EmojiChatBox
        className="fixed bottom-3 right-3 z-50"
        history={emojiHistory}
        groups={REACTION_GROUPS}
        selected={selectedReaction}
        onSelect={onSelectReaction}
        onSend={handleEmoji}
      />

      {/* Spectators can leave the room at any time */}
      {isSpectator && (
        <button
          onClick={onLeave}
          className="fixed top-3 left-3 z-50 text-white/70 hover:text-white text-sm flex items-center gap-1 transition-colors bg-black/40 backdrop-blur-sm rounded-full px-3 py-1.5"
        >
          ← 離開房間
        </button>
      )}

      {/* Everything that shakes on a bomb lives inside this wrapper. The fixed
          overlays (emoji box, settings gear) deliberately stay outside it — a
          transformed ancestor would become their containing block and break
          their positioning. */}
      {/* id: the card-flight overlay portals in here, so a card in the air is
          moved by the same shake transform as the table it is about to hit. */}
      <motion.div id="ddz-board" animate={shake} className="relative flex-1 flex flex-col min-h-0 ddz-table-ring">
      {/* ── Top opponents ───────────────────────────────── */}
      {/* pr-16 on mobile keeps the top-right seat/landlord cards clear of the fixed volume button */}
      <div className="flex justify-around px-4 pr-16 sm:pr-4 pt-4">
        {orderedPlayers.slice(1).map((member, seat) => {
          if (!member) return null;
          const globalIdx = players.indexOf(member);
          return (
            <div
              key={member.id}
              // Launch point for this seat's cards. The row is justify-around
              // inside a padding that changes at the sm breakpoint, so the seats
              // are nowhere near a fixed offset from the table on a phone.
              data-ddz-seat={seat === 0 ? 'left' : 'right'}
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
            <PlayArea
              lastPlay={table.play}
              playerName={table.name}
              origin={table.origin}
            />
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
                lastPlay={null}
                onSelectionChange={() => {}}
                turnEndTime={null}
                showActions={false}
              />
            )}
          </div>
        ) : (
          <>
            {/* Row 1: player seat + surrender button */}
            <div className="flex items-center gap-2 mb-1 px-2">
              {/* data-ddz-seat: anchor for anything that has to speak from this
                  seat, the way the top two are anchored for card flight. */}
              <div className="flex items-end gap-2" data-ddz-seat="self">
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
              lastPlay={lastPlay}
              onSelectionChange={setSelectedCards}
              turnEndTime={isMyTurn ? currentPlayerEndTime : null}
            />
          </>
        )}
      </motion.div>

      </motion.div>

      {/* ── Full-screen effect layers ────────────────────────────────────── */}
      <AnimatePresence>{phase === 'dealing' && <DealingOverlay />}</AnimatePresence>

      {/* ── Disconnect overlay ───────────────────────────────────────────── */}
      <AnimatePresence>
        {disconnectedPlayer && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/70 flex items-center justify-center z-[60]"
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
    </div>
  );
}
