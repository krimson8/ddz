import { Card, HandType, Play } from './types';

// ── Sort hand ─────────────────────────────────────────────────────────────────

/** Suit priority: spade(3) > heart(2) > club(1) > diamond(0); jokers by rank alone */
const SUIT_PRIORITY: Record<string, number> = {
  spade: 3,
  heart: 2,
  club: 1,
  diamond: 0,
  joker: -1,
};

/** Sort cards highest → lowest; same rank → spade > heart > club > diamond */
export function sortHand(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => {
    if (b.rank !== a.rank) return b.rank - a.rank;
    return (SUIT_PRIORITY[b.suit] ?? -1) - (SUIT_PRIORITY[a.suit] ?? -1);
  });
}

// ── Deck ─────────────────────────────────────────────────────────────────────

export function createDeck(): Card[] {
  const deck: Card[] = [];
  const suits: Array<'spade' | 'heart' | 'diamond' | 'club'> = [
    'spade',
    'heart',
    'diamond',
    'club',
  ];
  for (const suit of suits) {
    // ranks 3–15: 3=3 … K=13, A=14, 2=15
    for (let rank = 3; rank <= 15; rank++) {
      deck.push({ suit, rank });
    }
  }
  deck.push({ suit: 'joker', rank: 16 }); // Small Joker ☆
  deck.push({ suit: 'joker', rank: 17 }); // Big Joker ★
  return deck; // 4 × 13 + 2 = 54 cards
}

// ── Shuffle (Fisher-Yates) ────────────────────────────────────────────────────

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Hand Identification ───────────────────────────────────────────────────────

export function identifyHandType(
  cards: Card[],
): { type: HandType; rank: number } | null {
  if (cards.length === 0) return null;

  const n = cards.length;
  const ranks = cards.map((c) => c.rank).sort((a, b) => a - b);

  // Build frequency map
  const freq = new Map<number, number>();
  for (const r of ranks) freq.set(r, (freq.get(r) ?? 0) + 1);

  const uniqueRanks = [...freq.keys()].sort((a, b) => a - b);
  // counts sorted ascending — used for pattern matching
  const counts = [...freq.values()].sort((a, b) => a - b);

  // ── Rocket (火箭): Small + Big Joker ─────────────────────────────────────
  if (n === 2 && ranks[0] === 16 && ranks[1] === 17) {
    return { type: HandType.Rocket, rank: 17 };
  }

  // ── Single (單張) ─────────────────────────────────────────────────────────
  if (n === 1) return { type: HandType.Single, rank: ranks[0] };

  // ── Pair (對子) ───────────────────────────────────────────────────────────
  if (n === 2 && counts[0] === 2) {
    return { type: HandType.Pair, rank: uniqueRanks[0] };
  }

  // ── Bomb (炸彈): 4-of-a-kind ──────────────────────────────────────────────
  if (n === 4 && counts[0] === 4) {
    return { type: HandType.Bomb, rank: uniqueRanks[0] };
  }

  // ── Trio (三條) ───────────────────────────────────────────────────────────
  if (n === 3 && counts[0] === 3) {
    return { type: HandType.Trio, rank: uniqueRanks[0] };
  }

  // ── Trio + Single (三帶一) ────────────────────────────────────────────────
  if (n === 4 && counts.length === 2 && counts[1] === 3) {
    return { type: HandType.TrioSingle, rank: rankWithCount(freq, 3)! };
  }

  // ── Trio + Pair (三帶二) ──────────────────────────────────────────────────
  if (n === 5 && counts.length === 2 && counts[0] === 2 && counts[1] === 3) {
    return { type: HandType.TrioPair, rank: rankWithCount(freq, 3)! };
  }

  // ── Sequence (順子): ≥5 consecutive singles, ranks 3→A only ──────────────
  if (n >= 5 && counts.every((c) => c === 1)) {
    if (uniqueRanks.every((r) => r <= 14) && isConsecutive(uniqueRanks)) {
      return { type: HandType.Sequence, rank: uniqueRanks[n - 1] };
    }
    // All-unique ranks but not a valid sequence → definitely null
    return null;
  }

  // ── Pair Sequence (連對): ≥3 consecutive pairs, ranks 3→A only ────────────
  if (n >= 6 && n % 2 === 0 && counts.every((c) => c === 2)) {
    if (
      uniqueRanks.length >= 3 &&
      uniqueRanks.every((r) => r <= 14) &&
      isConsecutive(uniqueRanks)
    ) {
      return {
        type: HandType.PairSequence,
        rank: uniqueRanks[uniqueRanks.length - 1],
      };
    }
    return null;
  }

  // ── Trio Sequence (飛機): ≥2 consecutive trios, ranks 3→A only ────────────
  if (n >= 6 && n % 3 === 0 && counts.every((c) => c === 3)) {
    if (
      uniqueRanks.length >= 2 &&
      uniqueRanks.every((r) => r <= 14) &&
      isConsecutive(uniqueRanks)
    ) {
      return {
        type: HandType.TrioSequence,
        rank: uniqueRanks[uniqueRanks.length - 1],
      };
    }
    return null;
  }

  // ── Trio Sequence + Singles (飛機帶翅膀(單)): trioCount × 4 cards ───────────
  if (n >= 8 && n % 4 === 0) {
    const trioCount = n / 4;
    const rank = trioSeqKickerRank(freq, uniqueRanks, trioCount, 1);
    if (rank !== null) return { type: HandType.TrioSeqSingles, rank };
  }

  // ── Trio Sequence + Pairs (飛機帶翅膀(對)): trioCount × 5 cards ─────────────
  if (n >= 10 && n % 5 === 0) {
    const trioCount = n / 5;
    const rank = trioSeqKickerRank(freq, uniqueRanks, trioCount, 2);
    if (rank !== null) return { type: HandType.TrioSeqPairs, rank };
  }

  // ── Quad + 2 Singles (四帶二(單)) ─────────────────────────────────────────
  if (n === 6) {
    const quadRank = rankWithCount(freq, 4);
    if (quadRank !== null) {
      const singles = [...freq.values()].filter((v) => v === 1);
      if (singles.length === 2) return { type: HandType.QuadSingles, rank: quadRank };
    }
  }

  // ── Quad + 2 Pairs (四帶二(對)) ───────────────────────────────────────────
  if (n === 8) {
    const quadRank = rankWithCount(freq, 4);
    if (quadRank !== null) {
      const pairs = [...freq.values()].filter((v) => v === 2);
      if (pairs.length === 2) return { type: HandType.QuadPairs, rank: quadRank };
    }
  }

  return null;
}

// ── Play Validation ───────────────────────────────────────────────────────────

export function validatePlay(cards: Card[], lastPlay: Play | null): Play | null {
  const hand = identifyHandType(cards);
  if (!hand) return null;

  // New round — any valid hand is legal
  if (!lastPlay) return { type: hand.type, cards, rank: hand.rank };

  // Rocket beats everything
  if (hand.type === HandType.Rocket) {
    return { type: hand.type, cards, rank: hand.rank };
  }

  // Bomb beats any non-bomb, non-rocket; higher bomb beats lower bomb
  if (hand.type === HandType.Bomb) {
    if (lastPlay.type === HandType.Rocket) return null;
    if (lastPlay.type === HandType.Bomb && hand.rank <= lastPlay.rank) return null;
    return { type: hand.type, cards, rank: hand.rank };
  }

  // Regular hand cannot beat a bomb or rocket
  if (lastPlay.type === HandType.Bomb || lastPlay.type === HandType.Rocket) {
    return null;
  }

  // Must match hand type
  if (hand.type !== lastPlay.type) return null;

  // Sequence-type hands must have the same card count
  const seqTypes = new Set<HandType>([
    HandType.Sequence,
    HandType.PairSequence,
    HandType.TrioSequence,
    HandType.TrioSeqSingles,
    HandType.TrioSeqPairs,
  ]);
  if (seqTypes.has(hand.type) && cards.length !== lastPlay.cards.length) {
    return null;
  }

  // Must be strictly higher rank
  if (hand.rank <= lastPlay.rank) return null;

  return { type: hand.type, cards, rank: hand.rank };
}

// ── Private helpers ───────────────────────────────────────────────────────────

function isConsecutive(sorted: number[]): boolean {
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] !== sorted[i - 1] + 1) return false;
  }
  return true;
}

function rankWithCount(freq: Map<number, number>, count: number): number | null {
  for (const [rank, cnt] of freq) {
    if (cnt === count) return rank;
  }
  return null;
}

/**
 * Checks whether `freq` contains exactly `trioCount` consecutive trio-ranks
 * (all ≤ 14) plus exactly `trioCount` kicker-ranks each with `kickerSize`
 * copies. Returns the highest trio rank on match, null otherwise.
 */
function trioSeqKickerRank(
  freq: Map<number, number>,
  uniqueRanks: number[],
  trioCount: number,
  kickerSize: number,
): number | null {
  const trioRanks = uniqueRanks.filter((r) => freq.get(r) === 3);
  const kickerRanks = uniqueRanks.filter((r) => freq.get(r) === kickerSize);
  const otherRanks = uniqueRanks.filter(
    (r) => freq.get(r) !== 3 && freq.get(r) !== kickerSize,
  );

  if (
    trioRanks.length !== trioCount ||
    kickerRanks.length !== trioCount ||
    otherRanks.length !== 0 ||
    trioRanks.some((r) => r > 14) ||
    !isConsecutive(trioRanks)
  ) {
    return null;
  }

  return trioRanks[trioRanks.length - 1];
}
