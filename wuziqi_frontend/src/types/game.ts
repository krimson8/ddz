// 五子棋 (Gomoku) client types. Mirrors the wuziqi backend wire format.

export type StoneColor = "black" | "white";
export type WinnerColor = StoneColor | "draw";
export type WinReason = "five" | "timeout" | "resign" | "disconnect" | "draw";

/** Board cell: 0 empty, 1 black, 2 white. Indexed [y][x]. */
export type Cell = 0 | 1 | 2;
export type Board = Cell[][];

export interface Move {
  color: StoneColor;
  x: number;
  y: number;
}

/** Minimal member info sent to clients. */
export interface ClientMember {
  id: string; // = uid
  uid: string;
  nickname: string;
  avatarUrl: string | null;
  role: "spectator" | "player";
  color: StoneColor | null;
  wantToPlay: boolean;
  disconnected?: boolean;
}

/**
 * UI phases. Backend RoomState is waiting/starting/playing; we map those plus
 * the result window into these client phases.
 */
export type GamePhase = "lobby" | "starting" | "gameplay" | "result";

export interface GameState {
  phase: GamePhase;
  roomCode: string | null;
  members: ClientMember[];
  /** uids of the (up to 2) players this round. */
  playerOrder: string[];

  boardSize: number;
  board: Board;
  moves: Move[];
  /** Whose turn it currently is. */
  currentColor: StoneColor;
  /** My colour this round, or null if spectator / not playing. */
  myColor: StoneColor | null;
  blackUid: string | null;
  whiteUid: string | null;
  /** Epoch ms when the current turn's timer expires (server-authoritative). */
  currentPlayerEndTime: number | null;
  /** The last placed stone, for highlight. */
  lastMove: { x: number; y: number } | null;

  winnerColor: WinnerColor | null;
  winReason: WinReason | null;
  winnerUid: string | null;
  /** The 5 cells to highlight on a five-in-a-row, or null. */
  winningLine: { x: number; y: number }[] | null;

  /** uid → wins this room session. */
  winCounts: Record<string, number>;
  readyCount: number;
  canVote: boolean;
  /** Set when a player disconnects mid-game; cleared on reconnect or abort. */
  disconnectedPlayer: { nickname: string; endTime: number; timeoutMs: number } | null;
}
