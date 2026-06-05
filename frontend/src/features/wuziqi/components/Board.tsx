'use client';

import { Stone } from './Stone';
import type { Board as BoardType } from '@/features/wuziqi/types';

interface BoardProps {
  board: BoardType;
  size: number;
  /** Click an empty intersection to place. Disabled when interactive=false. */
  onPlace: (x: number, y: number) => void;
  interactive: boolean;
  lastMove: { x: number; y: number } | null;
  winningLine: { x: number; y: number }[] | null;
}

/**
 * Renders the size×size grid as cells; stones sit on intersections (cell
 * centres). The frontend computes nothing about wins or legality — it greys out
 * non-interactive clicks for UX but the server is the source of truth.
 */
export function Board({
  board,
  size,
  onPlace,
  interactive,
  lastMove,
  winningLine,
}: BoardProps) {
  const winSet = new Set((winningLine ?? []).map((c) => `${c.x},${c.y}`));

  return (
    <div
      className="relative mx-auto rounded-md shadow-2xl select-none"
      style={{
        width: 'min(92vw, 70vh, 600px)',
        height: 'min(92vw, 70vh, 600px)',
        background: '#d9a85f',
        padding: `calc(min(92vw, 70vh, 600px) / ${size} / 2)`,
      }}
    >
      <div
        className="relative w-full h-full"
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${size}, 1fr)`,
          gridTemplateRows: `repeat(${size}, 1fr)`,
        }}
      >
        {board.map((row, y) =>
          row.map((cell, x) => {
            const empty = cell === 0;
            const clickable = interactive && empty;
            const isLast = lastMove?.x === x && lastMove?.y === y;
            const isWinning = winSet.has(`${x},${y}`);
            return (
              <button
                key={`${x},${y}`}
                type="button"
                disabled={!clickable}
                onClick={() => clickable && onPlace(x, y)}
                className="relative"
                style={{ cursor: clickable ? 'pointer' : 'default' }}
                aria-label={`${x},${y}`}
              >
                {/* grid lines (drawn through the cell centre) */}
                <span
                  className="absolute bg-black/60"
                  style={{
                    left: '50%',
                    top: 0,
                    bottom: 0,
                    width: 1,
                    transform: 'translateX(-0.5px)',
                  }}
                />
                <span
                  className="absolute bg-black/60"
                  style={{
                    top: '50%',
                    left: 0,
                    right: 0,
                    height: 1,
                    transform: 'translateY(-0.5px)',
                  }}
                />
                {cell !== 0 && (
                  <Stone
                    color={cell === 1 ? 'black' : 'white'}
                    last={isLast}
                    winning={isWinning}
                  />
                )}
                {/* hover dot for placeable empty cells */}
                {clickable && (
                  <span className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-40">
                    <span
                      className="rounded-full bg-black"
                      style={{ width: '60%', height: '60%' }}
                    />
                  </span>
                )}
              </button>
            );
          }),
        )}
      </div>
    </div>
  );
}
