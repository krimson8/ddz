import type { Card, Play } from "@/features/ddz/types";
import { HandType } from "@/features/ddz/types";

function isConsecutive(sorted: number[]): boolean {
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] !== sorted[i - 1] + 1) return false;
  }
  return true;
}

function rankWithCount(
  freq: Map<number, number>,
  count: number,
): number | null {
  for (const [rank, cnt] of freq) {
    if (cnt === count) return rank;
  }
  return null;
}

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

export function identifyHandType(
  cards: Card[],
): { type: HandType; rank: number } | null {
  if (cards.length === 0) return null;
  const n = cards.length;
  const ranks = cards.map((c) => c.rank).sort((a, b) => a - b);
  const freq = new Map<number, number>();
  for (const r of ranks) freq.set(r, (freq.get(r) ?? 0) + 1);
  const uniqueRanks = [...freq.keys()].sort((a, b) => a - b);
  const counts = [...freq.values()].sort((a, b) => a - b);

  if (n === 2 && ranks[0] === 16 && ranks[1] === 17)
    return { type: HandType.Rocket, rank: 17 };
  if (n === 1) return { type: HandType.Single, rank: ranks[0] };
  if (n === 2 && counts[0] === 2)
    return { type: HandType.Pair, rank: uniqueRanks[0] };
  if (n === 4 && counts[0] === 4)
    return { type: HandType.Bomb, rank: uniqueRanks[0] };
  if (n === 3 && counts[0] === 3)
    return { type: HandType.Trio, rank: uniqueRanks[0] };
  if (n === 4 && counts.length === 2 && counts[1] === 3)
    return { type: HandType.TrioSingle, rank: rankWithCount(freq, 3)! };
  if (n === 5 && counts.length === 2 && counts[0] === 2 && counts[1] === 3)
    return { type: HandType.TrioPair, rank: rankWithCount(freq, 3)! };

  if (n >= 5 && counts.every((c) => c === 1)) {
    if (uniqueRanks.every((r) => r <= 14) && isConsecutive(uniqueRanks))
      return { type: HandType.Sequence, rank: uniqueRanks[n - 1] };
    return null;
  }
  if (n >= 6 && n % 2 === 0 && counts.every((c) => c === 2)) {
    if (
      uniqueRanks.length >= 3 &&
      uniqueRanks.every((r) => r <= 14) &&
      isConsecutive(uniqueRanks)
    )
      return {
        type: HandType.PairSequence,
        rank: uniqueRanks[uniqueRanks.length - 1],
      };
    return null;
  }
  if (n >= 6 && n % 3 === 0 && counts.every((c) => c === 3)) {
    if (
      uniqueRanks.length >= 2 &&
      uniqueRanks.every((r) => r <= 14) &&
      isConsecutive(uniqueRanks)
    )
      return {
        type: HandType.TrioSequence,
        rank: uniqueRanks[uniqueRanks.length - 1],
      };
    return null;
  }
  if (n >= 8 && n % 4 === 0) {
    const rank = trioSeqKickerRank(freq, uniqueRanks, n / 4, 1);
    if (rank !== null) return { type: HandType.TrioSeqSingles, rank };
  }
  if (n >= 10 && n % 5 === 0) {
    const rank = trioSeqKickerRank(freq, uniqueRanks, n / 5, 2);
    if (rank !== null) return { type: HandType.TrioSeqPairs, rank };
  }
  if (n === 6) {
    const quadRank = rankWithCount(freq, 4);
    if (
      quadRank !== null &&
      [...freq.values()].filter((v) => v === 1).length === 2
    )
      return { type: HandType.QuadSingles, rank: quadRank };
  }
  if (n === 8) {
    const quadRank = rankWithCount(freq, 4);
    if (
      quadRank !== null &&
      [...freq.values()].filter((v) => v === 2).length === 2
    )
      return { type: HandType.QuadPairs, rank: quadRank };
  }
  return null;
}

export function validatePlay(
  cards: Card[],
  lastPlay: Play | null,
): Play | null {
  const hand = identifyHandType(cards);
  if (!hand) return null;
  if (!lastPlay) return { type: hand.type, cards, rank: hand.rank };
  if (hand.type === HandType.Rocket)
    return { type: hand.type, cards, rank: hand.rank };
  if (hand.type === HandType.Bomb) {
    if (lastPlay.type === HandType.Rocket) return null;
    if (lastPlay.type === HandType.Bomb && hand.rank <= lastPlay.rank)
      return null;
    return { type: hand.type, cards, rank: hand.rank };
  }
  if (lastPlay.type === HandType.Bomb || lastPlay.type === HandType.Rocket)
    return null;
  if (hand.type !== lastPlay.type) return null;
  const seqTypes = new Set<HandType>([
    HandType.Sequence,
    HandType.PairSequence,
    HandType.TrioSequence,
    HandType.TrioSeqSingles,
    HandType.TrioSeqPairs,
  ]);
  if (seqTypes.has(hand.type) && cards.length !== lastPlay.cards.length)
    return null;
  if (hand.rank <= lastPlay.rank) return null;
  return { type: hand.type, cards, rank: hand.rank };
}
