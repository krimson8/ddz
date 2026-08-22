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

export type GamePhase = "lobby" | "dealing" | "bidding" | "roledraw" | "gameplay" | "result";

/** One of the three face-down 抽地主 cards. `role` is null while still face-down. */
export interface RoleSlot {
  /** Player index (0-2) who claimed this slot, or null if still face-down. */
  pickedBy: number | null;
  /** Revealed role once taken; null while face-down. */
  role: "landlord" | "peasant" | null;
}

export interface HistoryEntry {
  playerIndex: number;
  play: Play;
  /** If true, this entry represents a surrender (no cards). */
  surrender?: boolean;
}

/**
 * Snapshot of a finished round, kept alive after the server drops the room back
 * to the lobby so the end-of-round screen can stay up until the player is done
 * with it. Cleared by DISMISS_RESULT or when the next round starts.
 */
export interface RoundResult {
  winner: "landlord" | "peasants";
  winReason: "normal" | "surrender";
  winnerIds: string[];
  winningCards: Card[];
  winCounts: Record<string, number>;
  /** Players in seat order, captured before the room reset wipes them. */
  players: ClientMember[];
  playerOrder: string[];
  landlordIndex: number | null;
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
  /** The three 抽地主 (role-card draw) slots, used only when nobody volunteered. */
  roleSlots: RoleSlot[];
  /** Whether the local player has already claimed a role card this draw. */
  roleSubmitted: boolean;
  /**
   * True once the result is locked and the game is about to start. Picks no
   * longer count, but the leftover card may still be flipped for fun.
   */
  roleLocked: boolean;
  /** Full role deck, revealed on lock so the leftover card can be flipped for fun. */
  roleDeck: ("landlord" | "peasant")[] | null;
  lastPlay: Play | null;
  /** Socket ID of the player who made the last play */
  lastPlayedBy: string | null;
  winner: "landlord" | "peasants" | null;
  /** Reason the round ended — 'surrender' shows a different win banner */
  winReason: "normal" | "surrender";
  /** Player indices (0-2) currently flagged as surrendered (peasant toggles) */
  surrendered: number[];
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
  /** Set when a player disconnects mid-game; cleared on reconnect or abort. `endTime` is server epoch ms when the grace window expires. */
  disconnectedPlayer: { nickname: string; endTime: number; timeoutMs: number } | null;
  /** Last finished round, held until the player dismisses the result screen. */
  lastResult: RoundResult | null;
}
