import type { Card } from '@/features/ddz/types';

/**
 * Stable identity for a card across the hand and the table.
 *
 * Suit+rank is safe as a global key: a DDZ deck holds one of each of the 52
 * suited cards plus two uniquely-ranked jokers, and a card leaves a hand in the
 * same commit it appears on the table, so no two mounted cards ever share an id.
 *
 * This began life as a framer-motion `layoutId`, and the two sides disagreed on
 * the string — the hand emitted `card-p0-heart-14` while the play area emitted
 * `played-heart-14-0`, so the shared-layout transition never matched. Agreeing
 * on the id was necessary but not sufficient; see cardFlight.ts for why the
 * flight is now animated explicitly, and what this id keys instead.
 */
export function handLayoutId(card: Card): string {
  return `ddz-card-${card.suit}-${card.rank}`;
}
