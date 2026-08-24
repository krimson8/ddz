import type { HistoryEntry, Play } from '@/features/ddz/types';

/**
 * Which hit banner a play earns.
 *
 * Everything here is derived from what the server already sends on `lastPlay`
 * and `playHistory` — hand type, comparison rank, card count, and who played
 * what. No backend change is needed for any of it.
 */

/** 0 means no banner at all. The two contest levels sit outside the ladder. */
export type HitTier = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type HitLevel = HitTier | 'comeback' | 'friendly';

/** A(14) or 2(15) as the base of a hand bumps it up a tier. */
const HIGH_BASE = 14;

/**
 * How far down the deck a contest has to reach before it counts.
 *
 * A comeback only fires near the top of each shape, because beating a middling
 * pair is just play. Friendly fire reaches further down: a peasant burning a
 * teammate's J is already a blunder worth shouting about.
 */
const CB_PAIR_BASE = 13;   // 對K and up
const TRIO_BASE = 11;      // JJJ and up — shared by both contests
const FF_BASE = 11;        // J for singles and pairs

const TRIO_FAMILY = new Set(['trio', 'trio_single', 'trio_pair']);

/** Multi-card shapes that earn a contest when they beat their own type. */
const RUN_FAMILY = new Set([
  'pair_sequence',
  'sequence',
  'trio_sequence',
  'trio_seq_singles',
  'trio_seq_pairs',
  'quad_singles',
  'quad_pairs',
]);

/** Cards per group in the three plane shapes — 飛機 / 帶單 / 帶對. */
const PLANE_SIZE: Record<string, number> = {
  trio_sequence: 3,
  trio_seq_singles: 4,
  trio_seq_pairs: 5,
};

/** Groups in a plane, or 0 for anything that is not one. */
export function planeGroups(type: string, count: number): number {
  const size = PLANE_SIZE[type];
  return size ? count / size : 0;
}

/**
 * Is the newest entry the first actual play of the round?
 *
 * Passes do not count, so this stays true through a lead that everybody folded
 * to. One definition, because both the tier and the copy turn on it.
 */
export function isOpeningPlay(history: HistoryEntry[]): boolean {
  return history.filter((h) => h.play?.cards?.length).length === 1;
}

/**
 * Base tier for a play, ignoring context.
 *
 * `rank` is the play's comparison rank, which for 三帶一 is the trio's rank and
 * not the kicker's — that is what makes "based on 2 or A" a one-line test.
 * 14 = A, 15 = 2, 16 = 小王, 17 = 大王.
 *
 * `firstWin` decides one case and only one: 20 cards is the landlord's whole
 * hand, so a four-group 飛機帶對 opening the round wins off the deal, and that
 * is the only plane that reaches tier 7.
 */
export function baseTier(type: string, rank: number, count: number, firstWin = false): HitTier {
  const high = rank >= HIGH_BASE;
  switch (type) {
    case 'single':           return rank >= 15 ? 1 : 0;   // 2 and the jokers only
    case 'pair':
    case 'trio':             return high ? 2 : 1;
    case 'trio_single':
    case 'trio_pair':        return high ? 3 : 2;
    case 'pair_sequence':    return count / 2 > 3 ? 3 : 2;
    // The run ladder tops out at the full 3→A (12 cards), which is rarer than
    // any bomb and sits with them rather than below.
    case 'sequence':         return count >= 12 ? 6 : count >= 10 ? 5 : count >= 8 ? 3 : 2;
    case 'trio_sequence':
    case 'trio_seq_singles':
    case 'trio_seq_pairs': {
      const groups = planeGroups(type, count);
      if (groups > 3) return type === 'trio_seq_pairs' && firstWin ? 7 : 6;
      return groups === 3 ? 5 : 3;
    }
    case 'quad_singles':
    case 'quad_pairs':       return 5;
    case 'bomb':             return 6;                    // every bomb, not just AAAA+
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
 * contests on plays that never contested anything.
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

/**
 * Does this matchup qualify as a contest? Party is checked separately.
 *
 * Both levels ask the same question of the same shapes and differ only in how
 * high the beaten play has to be, so they share one function — two copies would
 * drift the moment either threshold moved.
 */
function matchup(curr: Play, prev: Play, mode: 'comeback' | 'friendly'): boolean {
  const c = curr.type as string;
  const p = prev.type as string;

  // A bomb answered by a bomb is a contest at any rank — the escalation is the
  // whole event, and both sides have just spent their get-out-of-jail card.
  if (c === 'bomb' && p === 'bomb') return true;

  if (c === 'single' && p === 'single') {
    if (mode === 'friendly') return prev.rank >= FF_BASE && curr.rank > prev.rank;
    if (curr.rank >= 16 && prev.rank === 15) return true;   // a joker over a 2
    return curr.rank === 17 && prev.rank === 16;            // 大王 over 小王
  }
  if (c === 'pair' && p === 'pair') {
    const base = mode === 'friendly' ? FF_BASE : CB_PAIR_BASE;
    return prev.rank >= base && curr.rank > prev.rank;
  }
  // 三帶X over a trio of jacks or better
  if (TRIO_FAMILY.has(c) && c === p) return prev.rank >= TRIO_BASE;
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

/** The contested play plus which side each half of it came from. */
function contest({ currPlayer, history, landlordIndex }: ComebackInput) {
  if (landlordIndex === null || landlordIndex < 0) return null;
  const beaten = beatenEntry(history);
  if (!beaten?.play) return null;
  const mine = partyOf(currPlayer, landlordIndex);
  const theirs = partyOf(beaten.playerIndex, landlordIndex);
  return {
    prev: beaten.play,
    sameSide: mine === theirs,
    peasants: mine === 'peasant' && theirs === 'peasant',
  };
}

/**
 * A comeback is a specific strong play answered by a stronger one *across the
 * table*. Peasant-over-peasant never counts here — that is the other level.
 */
export function isComeback(input: ComebackInput): boolean {
  const c = contest(input);
  return !!c && !c.sameSide && matchup(input.curr, c.prev, 'comeback');
}

/**
 * Friendly fire: the same shapes reaching further down the deck, but landing on
 * your own side. Only peasants can do it — the landlord has nobody to hit.
 */
export function isFriendlyFire(input: ComebackInput): boolean {
  const c = contest(input);
  return !!c && c.peasants && matchup(input.curr, c.prev, 'friendly');
}

/** Full level for a play, contests included. */
export function hitLevel(input: ComebackInput): HitLevel {
  const { curr } = input;
  const base = baseTier(
    curr.type as string,
    curr.rank,
    curr.cards.length,
    isOpeningPlay(input.history),
  );
  const prev = beatenEntry(input.history)?.play ?? null;
  const bombDuel = (curr.type as string) === 'bomb' && (prev?.type as string) === 'bomb';
  // The heavy tiers are already the loudest thing on the table and do not need
  // a contest badge on top. The one exception is a bomb answering a bomb, which
  // is worth calling out precisely because both sides just spent a bomb.
  if (base >= 5 && !bombDuel) return base;
  if (isComeback(input)) return 'comeback';
  if (isFriendlyFire(input)) return 'friendly';
  return base;
}

/**
 * Priority for the long-music channel: 神拳震撼波 > 殺 > 裏切り者 > 炸彈.
 *
 * A track is replaced when the incoming one ranks at least as high, so the same
 * level landing again restarts it — a second comeback should hit as hard as the
 * first. A weaker level while something bigger is running is ignored and the
 * running track plays out.
 *
 * Friendly fire sits above 炸彈 rather than below it because the case that
 * actually comes up is a peasant bombing a peasant's bomb: the 炸彈 track is
 * already running, and the traitor is the news.
 */
export function musicWeight(level: HitLevel): number {
  if (level === 6) return 100;          // 炸彈
  if (level === 'friendly') return 150; // 裏切り者のレクイエム
  if (level === 'comeback') return 200; // 殺
  if (level === 7) return 300;          // 火箭
  return 0;                              // no music
}

/** Track for a level, or null when the level has no music. */
export function musicTrack(level: HitLevel): string | null {
  if (level === 'friendly') return '/sounds/traitor.mp3';
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
  sequence_full:    { word: '坑龍有悔', sub: 'DRAGON REGRETS' },
  pair_sequence:    { word: '連對',     sub: 'DOUBLE RUN' },
  trio_sequence:    { word: '飛機',     sub: 'AIRPLANE' },
  trio_seq_singles: { word: '飛機帶單', sub: 'PLANE + ONES' },
  trio_seq_pairs:   { word: '飛機帶對', sub: 'PLANE + PAIRS' },
  plane_big:        { word: '大飛機',   sub: 'BIG PLANE' },
  plane_max:        { word: '我的很大你忍一下', sub: 'ME BIG YOU SMALL' },
  heaven:           { word: '天堂製造',     sub: 'MADE IN HEAVEN' },
  quad_singles:     { word: '四帶二',   sub: 'QUAD + TWO' },
  quad_pairs:       { word: '四帶二對', sub: 'QUAD + PAIRS' },
  bomb:             { word: '炸彈',     sub: 'BOMB' },
  rocket:           { word: '神拳震撼波', sub: 'GOD HAND IMPACT' },
  comeback:         { word: '殺',       sub: 'COMEBACK' },
  friendly:         { word: '裏切り者のレクイエム', sub: "TRAITOR'S REQUIEM" },
};

/**
 * Pick the banner copy for a play.
 *
 * `firstWin` is the 天堂製造 case: 20 cards is the landlord's entire hand, so a
 * four-group 飛機帶對 as the opening play of the round ends the game on the
 * deal. That hand and 火箭 are the only two plays that reach tier 7; every
 * other four-group plane is 我的很大你忍一下 at tier 6.
 */
export function labelFor(
  level: HitLevel,
  type: string,
  rank: number,
  count: number,
  firstWin = false,
) {
  if (level === 'comeback') return LEVEL_LABEL.comeback;
  if (level === 'friendly') return LEVEL_LABEL.friendly;
  if (type === 'single') {
    if (rank === 17) return LEVEL_LABEL.single_17;
    if (rank === 16) return LEVEL_LABEL.single_16;
    return LEVEL_LABEL.single_2;
  }
  if (type === 'sequence') {
    if (count >= 12) return LEVEL_LABEL.sequence_full;
    if (count >= 10) return LEVEL_LABEL.sequence_dragon;
    if (count >= 8) return LEVEL_LABEL.sequence_long;
    return LEVEL_LABEL.sequence;
  }
  const groups = planeGroups(type, count);
  if (groups) {
    if (groups > 3) {
      if (type === 'trio_seq_pairs' && firstWin) return LEVEL_LABEL.heaven;
      return LEVEL_LABEL.plane_max;
    }
    if (groups === 3) return LEVEL_LABEL.plane_big;
  }
  return LEVEL_LABEL[type] ?? { word: type, sub: '' };
}
