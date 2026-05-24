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
  /** Firebase UID — stable identity across reconnects */
  uid: string;
  /** Current socket.id — rotates per connection. Empty string when disconnected mid-game. */
  socketId: string;
  nickname: string;
  avatarUrl: string | null;
  role: 'spectator' | 'player';
  hand: Card[];
  wantToPlay: boolean;
  /** True iff this player dropped their socket mid-game and is within the reconnect grace window. */
  disconnected: boolean;
}

export type RoomState = 'waiting' | 'playing';

export interface HistoryEntry {
  playerIndex: number;
  play: Play;
  /** If true, this entry represents a surrender, not an actual play. `play.cards` is empty. */
  surrender?: boolean;
}

export interface Room {
  code: string;
  members: Member[];
  state: RoomState;
  eventSeq: number; // monotonically increasing counter; included in every room broadcast
  /** uids of the 3 players, set when game starts */
  playerUids: string[];
  deck: Card[];
  landlordCards: Card[]; // 3 face-down cards
  landlordIndex: number; // player index (0-2) within playerUids[0..2]
  currentTurn: number; // player index 0-2
  currentBid: number; // unused in yes/no bidding (kept for compat)
  currentBidder: number; // player index chosen as landlord
  passCount: number; // consecutive passes during gameplay
  lastPlay: Play | null;
  lastPlayedBy: number; // player index
  playHistory: HistoryEntry[]; // full play history for current round
  turnEndTime: number; // epoch ms when the current turn's 30s timer expires
  bidPassCount: number; // total votes cast during landlord bidding
  bidYesVoters: number[]; // player indices who said yes in landlord vote
  firstBidder: number; // player index who starts bidding
  bidTimer: NodeJS.Timeout | null; // 8s simultaneous bid window
  bidVotedIndices: number[]; // player indices who have already cast their bid
  turnTimer: NodeJS.Timeout | null; // per-turn 30s auto-pass timer
  /** uid → total wins in this room session (kept for in-game GameResult overlay) */
  winCounts: Record<string, number>;
  resultPending: boolean; // true during the 5s game_over → return_to_lobby delay
  /** Player indices (0-2) that have surrendered this round. Peasants toggle; landlord requires double-press. */
  surrendered: number[];
  /** Active mid-game disconnect grace window, if any. */
  reconnect: {
    uid: string;
    endTime: number; // epoch ms when the grace window expires → game aborts
    timer: NodeJS.Timeout;
  } | null;
}
