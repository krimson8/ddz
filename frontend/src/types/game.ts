export enum HandType {
  Single = "single",
  Pair = "pair",
  Trio = "trio",
  TrioSingle = "trio_single",
  TrioPair = "trio_pair",
  Sequence = "sequence",
  PairSequence = "pair_sequence",
  TrioSequence = "trio_sequence",
  TrioSeqSingles = "trio_seq_singles",
  TrioSeqPairs = "trio_seq_pairs",
  QuadSingles = "quad_singles",
  QuadPairs = "quad_pairs",
  Bomb = "bomb",
  Rocket = "rocket",
}

export interface Card {
  suit: "spade" | "heart" | "diamond" | "club" | "joker";
  /** 3–17: 3=3 … K=13, A=14, 2=15, SmallJoker=16, BigJoker=17 */
  rank: number;
}

export interface Play {
  type: HandType;
  cards: Card[];
  rank: number;
}

/** Minimal member info sent to clients (no server-internal fields) */
export interface ClientMember {
  id: string;
  nickname: string;
  avatarUrl: string | null;
  role: "spectator" | "player";
  wantToPlay: boolean;
  cardCount?: number;
}

export type RoomState = "waiting" | "playing";

export type GamePhase = "lobby" | "dealing" | "bidding" | "gameplay" | "result";

export interface HistoryEntry {
  playerIndex: number;
  play: Play;
}

export interface GameState {
  phase: GamePhase;
  roomCode: string | null;
  members: ClientMember[];
  /** Socket IDs of the 3 players in turn order */
  playerOrder: string[];
  myHand: Card[];
  landlordCards: Card[] | null;
  /** All 3 players' hands by playerOrder index — only meaningful for spectators */
  playerHands: Card[][];
  landlordIndex: number | null;
  /** Socket ID of the player whose turn it currently is (server-authoritative) */
  currentPlayer: string | null;
  /** Epoch ms when the current player's turn timer expires (server-authoritative) */
  currentPlayerEndTime: number | null;
  /** Unused in yes/no bidding system (kept for compat) */
  currentBid: number;
  /** How many players have cast their landlord bid this round (server-authoritative) */
  bidVotedCount: number;
  /** Whether the local player has already submitted their landlord bid */
  bidSubmitted: boolean;
  /** Milliseconds for the current bid window (from server bid_open) */
  bidTimeoutMs: number;
  lastPlay: Play | null;
  /** Socket ID of the player who made the last play */
  lastPlayedBy: string | null;
  winner: "landlord" | "peasants" | null;
  /** Socket IDs of winning players (server-authoritative, set on game_over) */
  winnerIds: string[];
  /** The cards played on the winning move (server-authoritative) */
  winningCards: Card[];
  playHistory: HistoryEntry[];
  /** Card counts per player index (0-2) during gameplay */
  playerCardCounts: number[];
  /** Per-room win tally: nickname → total wins */
  winCounts: Record<string, number>;
  /** How many members have wantToPlay=true (server-authoritative) */
  readyCount: number;
  /** Whether voting is currently allowed (server-authoritative, >=3 members in waiting state) */
  canVote: boolean;
  /** Set when a player disconnects mid-game; cleared on reconnect or abort */
  disconnectedPlayer: { nickname: string; timeoutMs: number } | null;
}
