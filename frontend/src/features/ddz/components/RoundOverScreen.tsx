'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Card as CardComponent } from './Card';
import { Confetti } from './effects/Confetti';
import { sfx } from '@/features/ddz/sfx';
import type { RoundResult } from '@/features/ddz/types';

/**
 * End-of-round screen.
 *
 * The server ends the round on its own clock and sends `return_to_lobby` a few
 * seconds later. Rather than fight that — the room genuinely has moved on — this
 * overlays a snapshot of the result taken at game over and stays up until the
 * player dismisses it. Game state underneath stays truthful the whole time, so
 * there is nothing to desync; the only thing being held back is the player.
 *
 * That matters now that a big finish can leave 40 seconds of music running: the
 * old five-second auto-return cut the track off mid-phrase.
 */
export function RoundOverScreen({
  result,
  myId,
  onDismiss,
}: {
  result: RoundResult | null;
  /** Local player's uid, for working out whether they were on the winning side. */
  myId: string;
  onDismiss: () => void;
}) {
  const [musicLeft, setMusicLeft] = useState(0);
  const iWon = !!result && result.winnerIds.includes(myId);

  /**
   * The win sting, on arrival rather than on game over.
   *
   * The round can end on a play that is still being narrated — a 火箭 cold
   * open, a 天堂製造 finale — and this screen waits for that to finish. The
   * sting waits with it, or it would land under someone else's music.
   *
   * A round that ended on a bomb or a comeback still has its track running, and
   * that track is the point of the end screen: don't stomp on it.
   */
  useEffect(() => {
    if (!result || sfx.isMusicPlaying()) return;
    sfx.play(iWon ? 'win' : 'lose');
  }, [result, iWon]);

  // Poll the music channel so the button can say whether a track is still
  // running — otherwise "stay and listen" is an invisible affordance.
  useEffect(() => {
    if (!result) return;
    const tick = () => setMusicLeft(Math.ceil(sfx.musicRemaining()));
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [result]);

  const dismiss = () => {
    sfx.stopMusic();
    onDismiss();
  };

  return (
    <AnimatePresence>
      {result && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/78 backdrop-blur-sm"
        >
          {iWon && <Confetti tone={result.winner === 'landlord' ? 'gold' : 'green'} />}

          <motion.div
            initial={{ scale: 0.82, opacity: 0, y: 24 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 22 }}
            className="relative w-full max-w-md flex flex-col items-center gap-5 rounded-2xl border border-yellow-400/30 bg-green-950/95 px-6 py-7 shadow-2xl"
          >
            <div className="flex items-center gap-3">
              <span className="text-4xl">{iWon ? '🏆' : '🥀'}</span>
              <h2 className="text-2xl font-black text-white drop-shadow">
                {result.winReason === 'surrender'
                  ? (result.winner === 'landlord' ? '農民投降輸一半！' : '地主投降輸一半！')
                  : (result.winner === 'landlord' ? '地主獲勝！' : '農民獲勝！')}
              </h2>
            </div>

            {/* Who won */}
            <div className="flex flex-wrap justify-center gap-2">
              {result.players.map((m, i) => {
                const won = result.winnerIds.includes(result.playerOrder[i]);
                const colors = ['bg-blue-500', 'bg-purple-500', 'bg-pink-500'];
                return (
                  <span
                    key={m.id}
                    className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                      won ? `${colors[i % colors.length]} text-white ring-1 ring-yellow-400` : 'bg-white/10 text-white/40'
                    }`}
                  >
                    {won ? '✓ ' : ''}{m.nickname}
                    {i === result.landlordIndex ? ' 👑' : ''}
                    {result.winCounts[m.nickname] ? ` · ${result.winCounts[m.nickname]}勝` : ''}
                  </span>
                );
              })}
            </div>

            {/* The hand that ended it */}
            {result.winningCards.length > 0 && (
              <div className="flex flex-col items-center gap-2">
                <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-white/40">
                  致勝牌
                </span>
                <div className="flex flex-wrap justify-center gap-1">
                  {result.winningCards.map((card, i) => (
                    <motion.div
                      key={`${card.suit}-${card.rank}-${i}`}
                      initial={{ opacity: 0, y: 14, rotateY: 90 }}
                      animate={{ opacity: 1, y: 0, rotateY: 0 }}
                      transition={{ delay: 0.25 + i * 0.07, type: 'spring', stiffness: 300, damping: 24 }}
                    >
                      <CardComponent {...card} glow="gold" />
                    </motion.div>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={dismiss}
              className="mt-1 min-h-[44px] w-full rounded-xl bg-yellow-400 px-6 py-2.5 text-sm font-bold text-green-950 transition-colors hover:bg-yellow-300"
            >
              返回大廳
            </button>

            <p className="-mt-2 text-center text-[11px] text-white/45">
              {musicLeft > 0
                ? `♪ 音樂播放中 · 還有 ${musicLeft} 秒，聽完再走也可以`
                : '慢慢看，準備好再回大廳'}
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
