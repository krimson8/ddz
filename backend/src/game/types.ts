export enum HandType {
  Single = 'single',
  Pair = 'pair',
  Trio = 'trio',
  TrioSingle = 'trio_single',
  TrioPair = 'trio_pair',
  Sequence = 'sequence',
  PairSequence = 'pair_sequence',
  TrioSequence = 'trio_sequence',
  TrioSeqSingles = 'trio_seq_singles',
  TrioSeqPairs = 'trio_seq_pairs',
  QuadSingles = 'quad_singles',
  QuadPairs = 'quad_pairs',
  Bomb = 'bomb',
  Rocket = 'rocket',
}

export interface Card {
  suit: 'spade' | 'heart' | 'diamond' | 'club' | 'joker';
  /** 3–17: 3=3 … K=13, A=14, 2=15, SmallJoker=16, BigJoker=17 */
  rank: number;
}

export interface Play {
  type: HandType;
  cards: Card[];
  /** Primary rank used for comparison */
  rank: number;
}

export interface Member {
  id: string; // socket.id
  nickname: string;
  reconnectToken: string; // UUID stored in client sessionStorage
  role: 'spectator' | 'player';
  hand: Card[];
  disconnectedAt?: number; // timestamp (ms) for reconnect-window tracking
}

export type RoomState = 'waiting' | 'voting' | 'playing';

export interface Room {
  code: string;
  members: Member[];
  state: RoomState;
  /** socket IDs in vote_play order; first 3 become players */
  voteQueue: string[];
  voteTimeout: NodeJS.Timeout | null;
  deck: Card[];
  landlordCards: Card[]; // 3 face-down cards
  landlordIndex: number; // player index (0-2) within voteQueue[0..2]
  currentTurn: number; // player index 0-2
  currentBid: number; // unused in yes/no bidding (kept for compat)
  currentBidder: number; // player index chosen as landlord
  passCount: number; // consecutive passes during gameplay
  lastPlay: Play | null;
  lastPlayedBy: number; // player index
  bidPassCount: number; // total votes cast during landlord bidding
  bidYesVoters: number[]; // player indices who said yes in landlord vote
  firstBidder: number; // player index who starts bidding
  bidTimer: NodeJS.Timeout | null; // 8s simultaneous bid window
  bidVotedIndices: number[]; // player indices who have already cast their bid
  idleTimeout: NodeJS.Timeout | null; // 5-min auto-delete timer
  reconnectTimers: Map<string, NodeJS.Timeout>; // socketId → 60s grace timer
  winCounts: Record<string, number>; // nickname → total wins in this room
}
