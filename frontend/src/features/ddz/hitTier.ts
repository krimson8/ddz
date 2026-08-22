import type { HistoryEntry, Play } from '@/features/ddz/types';

/**
 * Which hit banner a play earns.
 *
 * Everything here is derived from what the server already sends on `lastPlay`
 * and `playHistory` — hand type, comparison rank, card count, and who played
 * what. No backend change is needed for any of it.
 */

/** 0 means no banner at all. 'comeback' outranks every numeric tier. */
export type HitTier = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type HitLevel = HitTier | 'comeback';

/** A(14) or 2(15) as the base of a hand bumps it up a tier. */
const HIGH_BASE = 14;

const TRIO_FAMILY = new Set(['trio', 'trio_single', 'trio_pair']);

/** Multi-card shapes that earn a comeback when they beat their own type. */
const RUN_FAMILY = new Set([
  'pair_sequence',
  'sequence',
  'trio_sequence',
  'trio_seq_singles',
  'trio_seq_pairs',
  'quad_singles',
  'quad_pairs',
]);

/**
 * Base tier for a play, ignoring context.
 *
 * `rank` is the play's comparison rank, which for 三帶一 is the trio's rank and
 * not the kicker's — that is what makes "based on 2 or A" a one-line test.
 * 14 = A, 15 = 2, 16 = 小王, 17 = 大王.
 */
export function baseTier(type: string, rank: number, count: number): HitTier {
  const high = rank >= HIGH_BASE;
  switch (type) {
    case 'single':           return rank >= 15 ? 1 : 0;   // 2 and the jokers only
    case 'pair':
    case 'trio':             return high ? 2 : 1;
    case 'trio_single':
    case 'trio_pair':        return high ? 3 : 2;
    case 'pair_sequence':    return count / 2 > 3 ? 3 : 2;
    case 'sequence':         return count >= 12 ? 4 : count >= 8 ? 3 : 2;
    case 'trio_sequence':    return count / 3 > 3 ? 4 : 3;
    case 'trio_seq_singles': return count / 4 > 3 ? 4 : 3;
    case 'trio_seq_pairs':   return count / 5 > 3 ? 4 : 3;
    case 'quad_singles':
    case 'quad_pairs':       return 3;
    case 'bomb':             return high ? 6 : 5;         // AAAA / 2222
    case 'rocket':           return 7;
    default:                 return 1;
  }
}

/** Landlord or peasant, from a player's seat index. */
export function partyOf(playerIndex: number, landlordIndex: number | null): 'landlord' | 'peasant' {
  return playerIndex === landlordIndex ? 'landlord' : 'peasant';
}

/**
 * The play the newest entry is beating, or null if it is a fresh lead.
 *
 * A trick clears after two consecutive passes, so a play that follows two
 * passes leads a new trick and beats nothing — treating it as a beat would fire
 * comebacks on plays that never contested anything.
 */
export function beatenEntry(history: HistoryEntry[]): HistoryEntry | null {
  if (history.length < 2) return null;
  let passes = 0;
  for (let i = history.length - 2; i >= 0; i--) {
    const entry = history[i];
    if (entry.play?.cards?.length) {
      return passes >= 2 ? null : entry;
    }
    passes += 1;
    if (passes >= 2) return null;
  }
  return null;
}

/** Does this specific matchup qualify as a comeback? Party is checked separately. */
function comebackMatchup(curr: Play, prev: Play): boolean {
  const c = curr.type as string;
  const p = prev.type as string;

  if (c === 'single' && p === 'single') {
    if (curr.rank >= 16 && prev.rank === 15) return true;   // a joker over a 2
    if (curr.rank === 17 && prev.rank === 16) return true;  // 大王 over 小王
    return false;
  }
  // 對2 over 對A
  if (c === 'pair' && p === 'pair') return curr.rank === 15 && prev.rank === HIGH_BASE;
  // 三帶X over a trio of kings
  if (TRIO_FAMILY.has(c) && c === p) return prev.rank === 13;
  // A run, plane or quad+two beating its own shape
  if (RUN_FAMILY.has(c) && c === p) return true;
  return false;
}

export interface ComebackInput {
  /** The newest play. */
  curr: Play;
  /** Seat index of whoever made it. */
  currPlayer: number;
  /** Full play history, newest last, passes included. */
  history: HistoryEntry[];
  landlordIndex: number | null;
}

/**
 * A comeback is a specific strong play answered by a stronger one *across the
 * table*. Peasant-over-peasant never counts — the drama is in beating the other
 * side, and two farmers escalating on each other is routine play.
 */
export function isComeback({ curr, currPlayer, history, landlordIndex }: ComebackInput): boolean {
  if (landlordIndex === null || landlordIndex < 0) return false;
  const prev = beatenEntry(history);
  if (!prev?.play) return false;
  if (partyOf(currPlayer, landlordIndex) === partyOf(prev.playerIndex, landlordIndex)) return false;
  return comebackMatchup(curr, prev.play);
}

/** Full level for a play, comeback included. */
export function hitLevel(input: ComebackInput): HitLevel {
  const { curr } = input;
  const base = baseTier(curr.type as string, curr.rank, curr.cards.length);
  // Bombs and rockets keep their own tiers; they are already the loudest thing
  // on the table and do not need a comeback badge on top.
  if (base >= 5) return base;
  return isComeback(input) ? 'comeback' : base;
}

/**
 * Priority for the long-music channel. Higher wins.
 *
 * Only comeback, tier 6 and tier 7 own music. A track plays to its end unless
 * something that outranks it lands — which is what makes "a bigger bomb
 * restarts it" and "a rocket answers a bomb" fall out for free, rather than
 * needing to be special-cased.
 */
export function musicWeight(level: HitLevel, rank: number): number {
  if (level === 'comeback') return 100;
  if (level === 6) return 200 + rank;   // AAAA = 214, 2222 = 215
  if (level === 7) return 300;
  return 0;                              // no music
}

/** Track for a level, or null when the level has no music. */
export function musicTrack(level: HitLevel): string | null {
  if (level === 'comeback') return '/sounds/tier-comeback.mp3';
  if (level === 6) return '/sounds/tier6.mp3';
  if (level === 7) return '/sounds/tier7.mp3';
  return null;
}

/** Banner copy per level. */
export const LEVEL_LABEL: Record<string, { word: string; sub: string }> = {
  single_2:         { word: '大弟',     sub: 'DEUCE' },
  single_16:        { word: '小王',     sub: 'LITTLE JOKER' },
  single_17:        { word: '大王',     sub: 'BIG JOKER' },
  pair:             { word: '對子',     sub: 'PAIR' },
  trio:             { word: '三張',     sub: 'TRIO' },
  trio_single:      { word: '三帶一',   sub: 'TRIO + ONE' },
  trio_pair:        { word: '三帶對',   sub: 'TRIO + PAIR' },
  sequence:         { word: '順子',     sub: 'STRAIGHT' },
  sequence_long:    { word: '長順',     sub: 'LONG STRAIGHT' },
  sequence_dragon:  { word: '一條龍',   sub: 'DRAGON' },
  pair_sequence:    { word: '連對',     sub: 'DOUBLE RUN' },
  trio_sequence:    { word: '飛機',     sub: 'AIRPLANE' },
  trio_seq_singles: { word: '飛機帶單', sub: 'PLANE + ONES' },
  trio_seq_pairs:   { word: '飛機帶對', sub: 'PLANE + PAIRS' },
  quad_singles:     { word: '四帶二',   sub: 'QUAD + TWO' },
  quad_pairs:       { word: '四帶二對', sub: 'QUAD + PAIRS' },
  bomb:             { word: '炸彈',     sub: 'BOMB' },
  rocket:           { word: '火箭',     sub: 'ROCKET' },
  comeback:         { word: '反殺',     sub: 'COMEBACK' },
};

/** Pick the banner copy for a play. */
export function labelFor(level: HitLevel, type: string, rank: number, count: number) {
  if (level === 'comeback') return LEVEL_LABEL.comeback;
  if (type === 'single') {
    if (rank === 17) return LEVEL_LABEL.single_17;
    if (rank === 16) return LEVEL_LABEL.single_16;
    return LEVEL_LABEL.single_2;
  }
  if (type === 'sequence') {
    if (count >= 12) return LEVEL_LABEL.sequence_dragon;
    if (count >= 8) return LEVEL_LABEL.sequence_long;
    return LEVEL_LABEL.sequence;
  }
  return LEVEL_LABEL[type] ?? { word: type, sub: '' };
}
