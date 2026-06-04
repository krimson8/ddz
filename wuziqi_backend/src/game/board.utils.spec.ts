import {
  emptyBoard,
  applyMove,
  checkWin,
  randomEmptyCell,
  isFull,
  boardFromMoves,
  Board,
} from './board.utils';
import { Move, StoneColor } from './types';

const SIZE = 15;

/** Place a horizontal/vertical/diagonal run and return the board + last coord. */
function place(board: Board, coords: [number, number][], color: StoneColor): void {
  for (const [x, y] of coords) {
    if (!applyMove(board, x, y, color)) {
      throw new Error(`failed to place at ${x},${y}`);
    }
  }
}

describe('emptyBoard', () => {
  it('is size×size of zeros', () => {
    const b = emptyBoard(SIZE);
    expect(b.length).toBe(SIZE);
    expect(b.every((row) => row.length === SIZE)).toBe(true);
    expect(b.flat().every((c) => c === 0)).toBe(true);
  });
});

describe('applyMove', () => {
  it('places a stone and returns true', () => {
    const b = emptyBoard(SIZE);
    expect(applyMove(b, 7, 7, 'black')).toBe(true);
    expect(b[7][7]).toBe(1);
    expect(applyMove(b, 7, 8, 'white')).toBe(true);
    expect(b[8][7]).toBe(2);
  });

  it('rejects an occupied cell', () => {
    const b = emptyBoard(SIZE);
    applyMove(b, 3, 3, 'black');
    expect(applyMove(b, 3, 3, 'white')).toBe(false);
    expect(b[3][3]).toBe(1); // unchanged
  });

  it('rejects out-of-bounds', () => {
    const b = emptyBoard(SIZE);
    expect(applyMove(b, -1, 0, 'black')).toBe(false);
    expect(applyMove(b, 0, -1, 'black')).toBe(false);
    expect(applyMove(b, SIZE, 0, 'black')).toBe(false);
    expect(applyMove(b, 0, SIZE, 'black')).toBe(false);
  });
});

describe('checkWin — wins in all 4 directions', () => {
  it('horizontal five', () => {
    const b = emptyBoard(SIZE);
    place(b, [[2, 5], [3, 5], [4, 5], [5, 5], [6, 5]], 'black');
    const line = checkWin(b, 6, 5); // last placed
    expect(line).not.toBeNull();
    expect(line).toEqual([
      { x: 2, y: 5 },
      { x: 3, y: 5 },
      { x: 4, y: 5 },
      { x: 5, y: 5 },
      { x: 6, y: 5 },
    ]);
  });

  it('vertical five', () => {
    const b = emptyBoard(SIZE);
    place(b, [[8, 1], [8, 2], [8, 3], [8, 4], [8, 5]], 'white');
    const line = checkWin(b, 8, 3); // middle stone also detects
    expect(line).toEqual([
      { x: 8, y: 1 },
      { x: 8, y: 2 },
      { x: 8, y: 3 },
      { x: 8, y: 4 },
      { x: 8, y: 5 },
    ]);
  });

  it('diagonal ╲ five', () => {
    const b = emptyBoard(SIZE);
    place(b, [[3, 3], [4, 4], [5, 5], [6, 6], [7, 7]], 'black');
    const line = checkWin(b, 7, 7);
    expect(line).toEqual([
      { x: 3, y: 3 },
      { x: 4, y: 4 },
      { x: 5, y: 5 },
      { x: 6, y: 6 },
      { x: 7, y: 7 },
    ]);
  });

  it('diagonal ╱ five', () => {
    const b = emptyBoard(SIZE);
    place(b, [[3, 7], [4, 6], [5, 5], [6, 4], [7, 3]], 'white');
    const line = checkWin(b, 5, 5);
    expect(line).not.toBeNull();
    // line is built from the far "back" (negative dx,dy) end; for [1,-1] that
    // is the smallest-x end → (3,7) up to (7,3).
    expect(line).toEqual([
      { x: 3, y: 7 },
      { x: 4, y: 6 },
      { x: 5, y: 5 },
      { x: 6, y: 4 },
      { x: 7, y: 3 },
    ]);
  });
});

describe('checkWin — overlines (≥5 wins, free-style)', () => {
  it('six in a row is a win', () => {
    const b = emptyBoard(SIZE);
    place(b, [[1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0]], 'black');
    // placing the 6th completes a run of 6
    expect(checkWin(b, 6, 0)).not.toBeNull();
    // detecting from an interior stone also wins
    expect(checkWin(b, 3, 0)).not.toBeNull();
  });

  it('returns exactly 5 cells even for a longer run', () => {
    const b = emptyBoard(SIZE);
    place(b, [[1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0]], 'black');
    const line = checkWin(b, 6, 0);
    expect(line).toHaveLength(5);
  });
});

describe('checkWin — board edges & corners', () => {
  it('five along the top edge', () => {
    const b = emptyBoard(SIZE);
    place(b, [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]], 'black');
    expect(checkWin(b, 0, 0)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
      { x: 4, y: 0 },
    ]);
  });

  it('five down the right edge', () => {
    const b = emptyBoard(SIZE);
    const x = SIZE - 1;
    place(b, [[x, 10], [x, 11], [x, 12], [x, 13], [x, 14]], 'white');
    expect(checkWin(b, x, 14)).not.toBeNull();
  });

  it('diagonal anchored in the bottom-right corner', () => {
    const b = emptyBoard(SIZE);
    place(
      b,
      [[10, 10], [11, 11], [12, 12], [13, 13], [14, 14]],
      'black',
    );
    expect(checkWin(b, 14, 14)).toEqual([
      { x: 10, y: 10 },
      { x: 11, y: 11 },
      { x: 12, y: 12 },
      { x: 13, y: 13 },
      { x: 14, y: 14 },
    ]);
  });
});

describe('checkWin — no false positives', () => {
  it('four in a row is NOT a win', () => {
    const b = emptyBoard(SIZE);
    place(b, [[2, 2], [3, 2], [4, 2], [5, 2]], 'black');
    expect(checkWin(b, 5, 2)).toBeNull();
  });

  it('five split by a gap is NOT a win', () => {
    const b = emptyBoard(SIZE);
    // x x x _ x x  → max contiguous run is 3, then 2
    place(b, [[0, 4], [1, 4], [2, 4], [4, 4], [5, 4]], 'black');
    expect(checkWin(b, 5, 4)).toBeNull();
    expect(checkWin(b, 2, 4)).toBeNull();
  });

  it('five of MIXED colours is NOT a win', () => {
    const b = emptyBoard(SIZE);
    place(b, [[0, 6], [1, 6], [2, 6], [3, 6]], 'black');
    applyMove(b, 4, 6, 'white'); // black,black,black,black,white
    expect(checkWin(b, 4, 6)).toBeNull(); // the white stone
    expect(checkWin(b, 3, 6)).toBeNull(); // only 4 black contiguous
  });

  it('wraps do not count across rows', () => {
    const b = emptyBoard(SIZE);
    // end of one row + start of next must not be read as horizontal contiguity
    place(b, [[13, 3], [14, 3]], 'black');
    place(b, [[0, 4], [1, 4], [2, 4]], 'black');
    expect(checkWin(b, 14, 3)).toBeNull();
    expect(checkWin(b, 0, 4)).toBeNull();
  });

  it('empty cell never wins', () => {
    const b = emptyBoard(SIZE);
    expect(checkWin(b, 7, 7)).toBeNull();
  });
});

describe('isFull', () => {
  it('false for a fresh board, true once every cell is filled', () => {
    const b = emptyBoard(2);
    expect(isFull(b)).toBe(false);
    applyMove(b, 0, 0, 'black');
    applyMove(b, 1, 0, 'white');
    applyMove(b, 0, 1, 'white');
    expect(isFull(b)).toBe(false);
    applyMove(b, 1, 1, 'black');
    expect(isFull(b)).toBe(true);
  });
});

describe('randomEmptyCell', () => {
  it('returns an empty cell on a partial board', () => {
    const b = emptyBoard(3);
    applyMove(b, 1, 1, 'black');
    const cell = randomEmptyCell(b);
    expect(cell).not.toBeNull();
    expect(b[cell!.y][cell!.x]).toBe(0);
  });

  it('returns null when the board is full', () => {
    const b = emptyBoard(1);
    applyMove(b, 0, 0, 'black');
    expect(randomEmptyCell(b)).toBeNull();
  });

  it('only ever returns empty cells (sampled)', () => {
    const b = emptyBoard(4);
    // fill everything except (2,3)
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        if (!(x === 2 && y === 3)) applyMove(b, x, y, 'black');
      }
    }
    for (let i = 0; i < 20; i++) {
      expect(randomEmptyCell(b)).toEqual({ x: 2, y: 3 });
    }
  });
});

describe('boardFromMoves', () => {
  it('reconstructs a board from a move list', () => {
    const moves: Move[] = [
      { color: 'black', x: 0, y: 0 },
      { color: 'white', x: 1, y: 0 },
      { color: 'black', x: 7, y: 7 },
    ];
    const b = boardFromMoves(SIZE, moves);
    expect(b[0][0]).toBe(1);
    expect(b[0][1]).toBe(2);
    expect(b[7][7]).toBe(1);
    expect(b[5][5]).toBe(0);
  });
});
