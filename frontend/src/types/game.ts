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
  role: "spectator" | "player";
}

export type RoomState = "waiting" | "voting" | "playing";

export type GamePhase = "lobby" | "dealing" | "bidding" | "gameplay" | "result";

export interface HistoryEntry {
  playerIndex: number;
  play: Play;
}

export interface GameState {
  phase: GamePhase;
  roomCode: string | null;
  members: ClientMember[];
  /** Socket IDs of the 3 players in voteQueue (turn) order */
  playerOrder: string[];
  myHand: Card[];
  landlordCards: Card[] | null;
  landlordIndex: number | null;
  /** Player index (0-2) whose turn it is */
  currentTurn: number | null;
  /** Unused in yes/no bidding system (kept for compat) */
  currentBid: number;
  /** How many players have cast their landlord bid this round */
  bidVotedCount: number;
  lastPlay: Play | null;
  /** Global player index (0-2) who made the last play */
  lastPlayPlayerIndex: number | null;
  /** Nicknames of members who have voted "我要玩" */
  confirmedVoters: string[];
  winner: "landlord" | "peasants" | null;
  playHistory: HistoryEntry[];
  /** Card counts per player index (0-2) during gameplay */
  playerCardCounts: number[];
  /** Per-room win tally: nickname → total wins */
  winCounts: Record<string, number>;
}
