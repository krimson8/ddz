'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Board } from './Board';
import { GameResult } from './GameResult';
import { EmojiChatBox, type EmojiHistoryEntry } from '@/components/EmojiChatBox';
import type { GameState, StoneColor } from '@/features/wuziqi/types';

/** Pure render of remaining grace seconds — backend owns the truth (endTime). */
function CountdownNumber({ endTime }: { endTime: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const secondsLeft = Math.max(0, Math.ceil((endTime - now) / 1000));
  return <span className="tabular-nums">{secondsLeft}</span>;
}

const REACTION_GROUPS = [
  { label: '表情', items: ['🖕', '🤏', '🤌'] },
  {
    label: '語錄',
    items: ['我操', 'EZ', 'GG', '你會玩的嗎', '玩不了啦', '小兒科', '小癟三', '不用看了', '在我者離', '窩妖驗牌', '牌沒有問題', '給我搽皮鞋'],
  },
];

interface PlayerChipProps {
  nickname: string;
  avatarUrl: string | null;
  color: StoneColor;
  active: boolean;
  endTime: number | null;
  disconnected: boolean;
  wins: number;
}

function PlayerChip({ nickname, avatarUrl, color, active, endTime, disconnected, wins }: PlayerChipProps) {
  const isBlack = color === 'black';
  return (
    <div
      className={[
        'flex items-center gap-2 px-3 py-2 rounded-xl transition-all',
        active ? 'bg-yellow-400/20 ring-2 ring-yellow-400' : 'bg-white/10',
        disconnected ? 'opacity-50' : '',
      ].join(' ')}
    >
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt={nickname} className="w-10 h-10 rounded-full object-cover bg-white/10" />
      ) : (
        <span className="w-10 h-10 rounded-full bg-yellow-400 text-green-900 font-bold flex items-center justify-center">
          {nickname.slice(0, 1).toUpperCase()}
        </span>
      )}
      <div className="flex flex-col">
        <div className="flex items-center gap-1.5">
          <span
            className="w-4 h-4 rounded-full inline-block border"
            style={{
              background: isBlack
                ? 'radial-gradient(circle at 32% 28%, #555, #000)'
                : 'radial-gradient(circle at 32% 28%, #fff, #cfcfcf)',
              borderColor: 'rgba(0,0,0,0.3)',
            }}
          />
          <span className="text-white text-sm font-medium max-w-[90px] truncate">{nickname}</span>
        </div>
        <span className="text-white/50 text-xs">
          {isBlack ? '黑' : '白'} · {wins} 勝
          {active && endTime ? <> · <CountdownNumber endTime={endTime} />s</> : null}
        </span>
      </div>
    </div>
  );
}

interface GameBoardProps {
  gameState: GameState;
  myUid: string;
  onPlaceStone: (x: number, y: number) => void;
  onResign: () => void;
  onDrawVote: () => void;
  /** Send an emoji reaction (owned by the page-level emoji chat hook). */
  onReactEmoji: (emoji: string) => void;
  /** Recent emoji history shared across the lobby and game (page-owned). */
  emojiHistory: EmojiHistoryEntry[];
  selectedReaction: string;
  onSelectReaction: (value: string) => void;
  onLeave: () => void;
}

export function GameBoard({
  gameState,
  myUid,
  onPlaceStone,
  onResign,
  onDrawVote,
  onReactEmoji,
  emojiHistory,
  selectedReaction,
  onSelectReaction,
  onLeave,
}: GameBoardProps) {
  const {
    members,
    board,
    boardSize,
    currentColor,
    myColor,
    blackUid,
    whiteUid,
    currentPlayerEndTime,
    lastMove,
    winningLine,
    winnerColor,
    winReason,
    winnerUid,
    winCounts,
    phase,
    disconnectedPlayer,
    drawVoters,
  } = gameState;

  const isSpectator = myColor === null;
  const iVotedDraw = drawVoters.includes(myUid);
  const opponentVotedDraw = drawVoters.some((uid) => uid !== myUid);
  const isMyTurn = !isSpectator && myColor === currentColor && phase === 'gameplay';

  const blackMember = members.find((m) => m.uid === blackUid);
  const whiteMember = members.find((m) => m.uid === whiteUid);

  const spectatorCount = members.filter((m) => m.role === 'spectator').length;

  return (
    <div className="relative min-h-screen bg-green-900 flex flex-col items-center select-none overflow-hidden">
      {/* Leave top bar */}
      <div className="w-full flex items-center justify-start px-3 py-2">
        <button
          onClick={onLeave}
          className="text-white/70 hover:text-white text-sm bg-black/40 rounded-full px-3 py-1.5"
        >
          ← 離開房間
        </button>
      </div>

      {/* Player chips */}
      <div className="flex items-center gap-3 mb-3 flex-wrap justify-center px-2">
        {blackMember && (
          <PlayerChip
            nickname={blackMember.nickname}
            avatarUrl={blackMember.avatarUrl}
            color="black"
            active={currentColor === 'black' && phase === 'gameplay'}
            endTime={currentColor === 'black' ? currentPlayerEndTime : null}
            disconnected={!!blackMember.disconnected}
            wins={winCounts[blackMember.uid] ?? 0}
          />
        )}
        <span className="text-white/40 text-sm">VS</span>
        {whiteMember && (
          <PlayerChip
            nickname={whiteMember.nickname}
            avatarUrl={whiteMember.avatarUrl}
            color="white"
            active={currentColor === 'white' && phase === 'gameplay'}
            endTime={currentColor === 'white' ? currentPlayerEndTime : null}
            disconnected={!!whiteMember.disconnected}
            wins={winCounts[whiteMember.uid] ?? 0}
          />
        )}
      </div>

      {isSpectator && (
        <p className="text-white/40 text-xs italic mb-1">觀戰中</p>
      )}
      {spectatorCount > 0 && !isSpectator && (
        <p className="text-white/30 text-xs mb-1">{spectatorCount} 人觀戰</p>
      )}

      {/* Board */}
      <Board
        board={board}
        size={boardSize}
        onPlace={onPlaceStone}
        interactive={isMyTurn}
        lastMove={lastMove}
        winningLine={winningLine}
      />

      {/* Turn hint */}
      {phase === 'gameplay' && (
        <p className="text-white/70 text-sm mt-3 h-5">
          {isSpectator
            ? `輪到 ${currentColor === 'black' ? '黑棋' : '白棋'}`
            : isMyTurn
              ? '輪到你了'
              : '等待對手…'}
        </p>
      )}

      {/* Resign / draw-vote buttons */}
      {!isSpectator && phase === 'gameplay' && (
        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={onResign}
            className="text-white/80 hover:text-white text-sm bg-red-600/70 hover:bg-red-500 rounded-full px-4 py-1.5 font-bold"
          >
            認輸
          </button>
          <button
            onClick={onDrawVote}
            className={`text-sm rounded-full px-4 py-1.5 font-bold transition-colors ${
              iVotedDraw
                ? 'bg-yellow-400 text-green-900 hover:bg-yellow-300'
                : 'text-white/80 hover:text-white bg-white/15 hover:bg-white/25'
            }`}
          >
            和局{iVotedDraw ? '（已提議）' : opponentVotedDraw ? '（對手提議中）' : ''}
          </button>
        </div>
      )}

      {/* Draggable emoji chatbox — fixed + highest z so the player can move it
          anywhere on screen and it always sits above the board. */}
      <EmojiChatBox
        className="fixed bottom-3 right-3 z-50"
        history={emojiHistory}
        groups={REACTION_GROUPS}
        selected={selectedReaction}
        onSelect={onSelectReaction}
        onSend={() => onReactEmoji(selectedReaction)}
      />

      {/* Disconnect overlay */}
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
              <div className="text-5xl font-black text-yellow-400 tabular-nums drop-shadow">
                <CountdownNumber endTime={disconnectedPlayer.endTime} />
              </div>
              <p className="text-white/70 text-sm">等待重連中，若逾時則判對手獲勝</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Result */}
      <AnimatePresence>
        {phase === 'result' && winnerColor && (
          <GameResult
            winnerColor={winnerColor}
            winReason={winReason ?? 'five'}
            iWon={winnerUid === myUid}
            isSpectator={isSpectator}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
