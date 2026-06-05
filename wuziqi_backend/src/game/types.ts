/**
 * 五子棋 (Gomoku) game types.
 *
 * Ported from the DDZ backend, with all card/bidding concepts removed and
 * replaced by board state. See SPEC_WUZIQI.md §5/§6.
 *
 * Identity model (unchanged from DDZ): members are identified by `uid`
 * (Firebase UID). socketId rotates per connection.
 */

export type StoneColor = 'black' | 'white';

/** A single placed stone, in play order. Persisted to wuziqi_results.moves. */
export interface Move {
  color: StoneColor;
  /** 0-indexed board coordinates. board[y][x]. */
  x: number;
  y: number;
}

export interface Member {
  /** Firebase UID — stable identity across reconnects. */
  uid: string;
  /** Current socket.id — rotates per connection. Empty string when disconnected mid-game. */
  socketId: string;
  nickname: string;
  avatarUrl: string | null;
  role: 'spectator' | 'player';
  /** Assigned at game start; null until then (and reset to null between rounds). */
  color: StoneColor | null;
  wantToPlay: boolean;
  /** True iff this player dropped their socket mid-game and is within the reconnect grace window. */
  disconnected: boolean;
}

/**
 * - `waiting`  — in-room lobby; votes accepted.
 * - `starting` — 2nd vote locked in; players frozen, short start countdown running.
 *                No further votes or re-entry into the start flow are allowed.
 *                (Kept from DDZ. SPEC_WUZIQI lists waiting/playing/result, but the
 *                 DDZ mechanism uses a `starting` interstitial + `resultPending`
 *                 flag for the result phase — we mirror the proven mechanism.)
 * - `playing`  — stones being placed.
 */
export type RoomState = 'waiting' | 'starting' | 'playing';

export type WinnerColor = StoneColor | 'draw';
export type WinReason = 'five' | 'timeout' | 'resign' | 'disconnect' | 'draw';

export interface Room {
  code: string;
  members: Member[];
  state: RoomState;
  eventSeq: number; // monotonically increasing; included in every room broadcast

  // ── board state (authoritative) ──
  boardSize: number; // 15
  /** 0 empty, 1 black, 2 white. Indexed [y][x]. */
  board: (0 | 1 | 2)[][];
  /** Stones placed this round, in play order. */
  moves: Move[];
  /** Whose turn it is. Meaningful only while state === 'playing'. */
  currentColor: StoneColor;
  /** uids of the two players for the current round (set at game start). */
  blackUid: string | null;
  whiteUid: string | null;
  turnEndTime: number; // epoch ms when the current turn's timer expires; 0 when no active timer
  turnTimer: NodeJS.Timeout | null;

  winnerColor: WinnerColor | null;
  winReason: WinReason | null;

  /**
   * uids of players who currently want a draw (和局). A draw is agreed only when
   * BOTH current players' uids are present. Cleared on any stone placement and
   * when the round ends/resets. Mirrors the DDZ surrender-vote mechanic.
   */
  drawVotes: Set<string>;

  /** uid → total wins in this room session (for the in-game result overlay). */
  winCounts: Record<string, number>;
  resultPending: boolean; // true during the game_over → return_to_lobby delay

  /** Active mid-game disconnect grace window, if any. */
  reconnect: {
    uid: string;
    endTime: number; // epoch ms when the grace window expires → game aborts
    timer: NodeJS.Timeout;
  } | null;
}
