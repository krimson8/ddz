import type { Card } from '@/features/ddz/types';

/**
 * Shared layout identity for a card, so framer-motion can fly it from the hand
 * into the play area instead of cross-fading two unrelated elements.
 *
 * This has to be the *same* string on both sides. It previously was not — the
 * hand emitted `card-p0-heart-14` while the play area emitted `played-heart-14-0`
 * — so the shared-layout transition never matched and the animation the code was
 * written for never actually ran.
 *
 * Suit+rank is safe as a global key: a DDZ deck holds one of each of the 52
 * suited cards plus two uniquely-ranked jokers, and a card is removed from a
 * hand in the same commit it appears on the table, so no two mounted cards ever
 * share an id.
 */
export function handLayoutId(card: Card): string {
  return `ddz-card-${card.suit}-${card.rank}`;
}
