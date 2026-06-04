import { Move, StoneColor } from './types';

/**
 * 五子棋 board engine — the only genuinely new logic in this port.
 *
 * Board representation: `(0 | 1 | 2)[][]` indexed `[y][x]`.
 *   0 = empty, 1 = black, 2 = white.
 * Coordinates are 0-indexed in `[0, size)`.
 *
 * Ruleset (SPEC_WUZIQI §6.1): free-style five-in-a-row — five OR MORE contiguous
 * same-colour stones in any of the 4 line orientations wins. No overline/Renju
 * restrictions.
 */

export type Cell = 0 | 1 | 2;
export type Board = Cell[][];

const WIN_LEN = 5;

/** The numeric cell value for a colour. */
export function cellFor(color: StoneColor): 1 | 2 {
  return color === 'black' ? 1 : 2;
}

/** A fresh empty size×size board (all 0). */
export function emptyBoard(size: number): Board {
  return Array.from({ length: size }, () =>
    Array.from({ length: size }, () => 0 as Cell),
  );
}

function inBounds(board: Board, x: number, y: number): boolean {
  return y >= 0 && y < board.length && x >= 0 && x < board.length;
}

/**
 * Place a stone, mutating the board in place. Returns true on success, false if
 * the target is out of bounds or already occupied. Callers (the game service)
 * validate legality first; this is the low-level apply.
 */
export function applyMove(board: Board, x: number, y: number, color: StoneColor): boolean {
  if (!inBounds(board, x, y)) return false;
  if (board[y][x] !== 0) return false;
  board[y][x] = cellFor(color);
  return true;
}

/** True iff every cell is filled (board full → draw if no five). */
export function isFull(board: Board): boolean {
  for (const row of board) {
    for (const cell of row) {
      if (cell === 0) return false;
    }
  }
  return true;
}

/** All empty cells, as {x,y}. */
function emptyCells(board: Board): { x: number; y: number }[] {
  const cells: { x: number; y: number }[] = [];
  for (let y = 0; y < board.length; y++) {
    for (let x = 0; x < board.length; x++) {
      if (board[y][x] === 0) cells.push({ x, y });
    }
  }
  return cells;
}

/**
 * Pick a uniformly random empty cell, or null if the board is full.
 * Used by the backend to auto-place a move on turn timeout (SPEC_WUZIQI §6.2).
 */
export function randomEmptyCell(board: Board): { x: number; y: number } | null {
  const cells = emptyCells(board);
  if (cells.length === 0) return null;
  return cells[Math.floor(Math.random() * cells.length)];
}

// The 4 line orientations, as (dx, dy) steps. We only need one direction per
// axis because checkWin scans both ways from the placed stone.
const DIRECTIONS: [number, number][] = [
  [1, 0], // horizontal —
  [0, 1], // vertical |
  [1, 1], // diagonal ╲
  [1, -1], // diagonal ╱
];

/**
 * Check whether the stone just placed at (x, y) completes a run of WIN_LEN or
 * more same-colour stones in any orientation.
 *
 * Returns the winning line as an array of the WIN_LEN cells (the 5 at the
 * "start" end of the maximal run) to highlight client-side, or null if no win.
 * The board must already contain the stone at (x, y).
 */
export function checkWin(
  board: Board,
  x: number,
  y: number,
): { x: number; y: number }[] | null {
  const target = board[y]?.[x];
  if (!target) return null; // empty (0) or out of bounds (undefined)

  for (const [dx, dy] of DIRECTIONS) {
    // Count contiguous same-colour stones in the negative direction…
    let back = 0;
    let cx = x - dx;
    let cy = y - dy;
    while (inBounds(board, cx, cy) && board[cy][cx] === target) {
      back++;
      cx -= dx;
      cy -= dy;
    }
    // …and the positive direction.
    let fwd = 0;
    cx = x + dx;
    cy = y + dy;
    while (inBounds(board, cx, cy) && board[cy][cx] === target) {
      fwd++;
      cx += dx;
      cy += dy;
    }

    const runLen = back + 1 + fwd; // include the placed stone
    if (runLen >= WIN_LEN) {
      // Build the line from the far "back" end forward, take the first 5 cells.
      const startX = x - dx * back;
      const startY = y - dy * back;
      const line: { x: number; y: number }[] = [];
      for (let i = 0; i < WIN_LEN; i++) {
        line.push({ x: startX + dx * i, y: startY + dy * i });
      }
      return line;
    }
  }

  return null;
}

/** Rebuild a board from a move list (used for replay / reconnect snapshots). */
export function boardFromMoves(size: number, moves: Move[]): Board {
  const board = emptyBoard(size);
  for (const m of moves) {
    if (inBounds(board, m.x, m.y)) board[m.y][m.x] = cellFor(m.color);
  }
  return board;
}
