'use client';

import { motion } from 'framer-motion';
import type { RoleSlot } from '@/features/ddz/types';

interface RoleDrawPanelProps {
  /** The three face-down / revealed role cards. */
  slots: RoleSlot[];
  /** Whether the local player has already claimed a card. */
  hasPicked: boolean;
  /** True once the result is locked and the game is about to start. */
  locked: boolean;
  /** The local player's index (0-2), used to label "my" pick. */
  myPlayerIndex: number;
  /** Nicknames keyed by player index (0-2). */
  playerNames: (string | undefined)[];
  /** Claim a card (real pick — only before lock). */
  onPick: (slotIndex: number) => void;
  /** Flip the leftover card for fun (local only — after lock). */
  onRevealForFun: (slotIndex: number) => void;
}

/**
 * 抽地主 (role-card draw) panel. Shown only when nobody volunteered for landlord.
 * Three face-down cards — one 地主 + two 農民 — are laid out; each player taps one
 * to claim it. The moment a card is taken it flips face-up for everyone, showing
 * the role and who took it. Once all three are claimed the backend pauses 3s on
 * the revealed cards, then deals the 地主 the bottom three cards and starts play.
 */
export function RoleDrawPanel({
  slots,
  hasPicked,
  locked,
  myPlayerIndex,
  playerNames,
  onPick,
  onRevealForFun,
}: RoleDrawPanelProps) {
  const pickedCount = slots.filter((s) => s.pickedBy !== null).length;

  return (
    <div className="flex flex-col items-center gap-5 p-6 bg-green-900/95 rounded-2xl border border-yellow-400/30 shadow-2xl min-w-[300px]">
      <p className="text-white text-lg font-bold text-center">無人搶地主，抽地主！</p>
      {locked ? (
        <p className="text-yellow-300 text-sm font-semibold animate-pulse">遊戲即將開始…</p>
      ) : (
        <p className="text-white/60 text-sm">{pickedCount}/3 已抽</p>
      )}

      <div className="flex gap-4">
        {slots.map((slot, i) => {
          // `role` set means the card is face-up; a claimed card also has pickedBy.
          const faceUp = slot.role !== null;
          const mine = slot.pickedBy === myPlayerIndex;
          const isLandlord = slot.role === 'landlord';
          // Before lock: tappable to claim if I haven't picked and it's face-down.
          // After lock: the leftover face-down card is tappable to flip for fun.
          const canClaim = !locked && !hasPicked && !faceUp;
          const canRevealForFun = locked && !faceUp;
          const tappable = canClaim || canRevealForFun;

          return (
            <div key={i} className="ddz-scene-near relative w-20 h-28">
              <motion.button
                disabled={!tappable}
                whileTap={tappable ? { scale: 0.92 } : undefined}
                whileHover={tappable ? { y: -6 } : undefined}
                onClick={
                  canClaim
                    ? () => onPick(i)
                    : canRevealForFun
                      ? () => onRevealForFun(i)
                      : undefined
                }
                // The reveal is a genuine Y-axis rotation with both faces
                // mounted and backface-culled, so the card turns over rather
                // than cross-fading between two states.
                className={`preserve-3d relative w-full h-full ${tappable ? 'cursor-pointer' : 'cursor-default'}`}
                initial={false}
                animate={{ rotateY: faceUp ? 0 : 180 }}
                transition={{ type: 'spring', stiffness: 150, damping: 17 }}
              >
                {/* Face — the revealed role */}
                <span
                  className={[
                    'backface-hidden absolute inset-0 rounded-xl flex flex-col items-center justify-center font-bold border-2',
                    isLandlord
                      ? 'bg-gradient-to-br from-yellow-300 to-amber-500 text-red-900 border-yellow-100 shadow-[0_0_22px_rgba(250,204,21,0.55)]'
                      : 'bg-gradient-to-br from-white to-gray-200 text-green-900 border-gray-300',
                  ].join(' ')}
                  style={{ transform: 'rotateY(0deg)' }}
                >
                  <span className="text-3xl">{isLandlord ? '👑' : '🌾'}</span>
                  <span className="text-base mt-1">{isLandlord ? '地主' : '農民'}</span>
                </span>

                {/* Back — still face-down */}
                <span
                  className={[
                    'backface-hidden absolute inset-0 rounded-xl flex items-center justify-center border-2',
                    tappable
                      ? 'bg-gradient-to-br from-red-700 to-red-900 text-yellow-300 border-yellow-400/40'
                      : 'bg-gradient-to-br from-red-900 to-red-950 text-yellow-300/40 border-yellow-400/10',
                  ].join(' ')}
                  style={{ transform: 'rotateY(180deg)' }}
                >
                  <span className="text-4xl">🀄</span>
                </span>
              </motion.button>

              {faceUp && slot.pickedBy !== null && (
                <motion.span
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.25 }}
                  className="absolute -bottom-5 left-0 right-0 text-center text-[11px] text-white/70 whitespace-nowrap"
                >
                  {mine ? '你' : playerNames[slot.pickedBy] ?? '玩家'}
                </motion.span>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-white/40 text-xs text-center mt-3">
        {locked
          ? '結果已定，等待開始…'
          : hasPicked
            ? '已抽牌，等待其他玩家…'
            : '點一張牌，抽到地主即為地主'}
      </p>
    </div>
  );
}
