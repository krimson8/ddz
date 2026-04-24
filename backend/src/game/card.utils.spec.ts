import {
  createDeck,
  identifyHandType,
  shuffle,
  validatePlay,
} from './card.utils';
import { Card, HandType } from './types';

/** Helper: build Card[] from [rank, suit?] tuples (suit defaults to 'spade') */
function c(...specs: [number, Card['suit']?][]): Card[] {
  return specs.map(([rank, suit = 'spade']) => ({ rank, suit }));
}

// ── createDeck ────────────────────────────────────────────────────────────────

describe('createDeck', () => {
  it('returns exactly 54 cards', () => {
    expect(createDeck()).toHaveLength(54);
  });

  it('contains SmallJoker (rank 16) and BigJoker (rank 17)', () => {
    const deck = createDeck();
    expect(deck.filter((card) => card.rank === 16)).toHaveLength(1);
    expect(deck.filter((card) => card.rank === 17)).toHaveLength(1);
  });

  it('has no duplicate [suit, rank] pairs', () => {
    const deck = createDeck();
    const keys = deck.map((card) => `${card.suit}-${card.rank}`);
    expect(new Set(keys).size).toBe(54);
  });

  it('contains exactly 4 cards for each rank 3–15', () => {
    const deck = createDeck();
    for (let rank = 3; rank <= 15; rank++) {
      expect(deck.filter((card) => card.rank === rank)).toHaveLength(4);
    }
  });
});

// ── shuffle ───────────────────────────────────────────────────────────────────

describe('shuffle', () => {
  it('returns the same number of elements', () => {
    const deck = createDeck();
    expect(shuffle(deck)).toHaveLength(54);
  });

  it('does not mutate the original array', () => {
    const deck = createDeck();
    const copy = [...deck];
    shuffle(deck);
    expect(deck).toEqual(copy);
  });

  it('contains the same cards (sorted comparison)', () => {
    const deck = createDeck();
    const key = (card: Card) => `${card.suit}-${card.rank}`;
    const sort = (arr: Card[]) => [...arr].sort((a, b) => key(a).localeCompare(key(b)));
    expect(sort(shuffle(deck))).toEqual(sort(deck));
  });
});

// ── identifyHandType ──────────────────────────────────────────────────────────

describe('identifyHandType', () => {
  it('returns null for empty array', () => {
    expect(identifyHandType([])).toBeNull();
  });

  // Single
  it('Single: one card', () => {
    expect(identifyHandType(c([5]))).toEqual({ type: HandType.Single, rank: 5 });
  });

  it('Single: BigJoker', () => {
    expect(identifyHandType(c([17, 'joker']))).toEqual({
      type: HandType.Single,
      rank: 17,
    });
  });

  // Pair
  it('Pair: two same-rank cards', () => {
    expect(identifyHandType(c([5], [5, 'heart']))).toEqual({
      type: HandType.Pair,
      rank: 5,
    });
  });

  it('Two different ranks → null', () => {
    expect(identifyHandType(c([5], [6]))).toBeNull();
  });

  // Trio
  it('Trio: three same-rank cards', () => {
    expect(identifyHandType(c([5], [5, 'heart'], [5, 'diamond']))).toEqual({
      type: HandType.Trio,
      rank: 5,
    });
  });

  // Trio + Single
  it('Trio + Single', () => {
    expect(identifyHandType(c([5], [5, 'heart'], [5, 'diamond'], [3]))).toEqual({
      type: HandType.TrioSingle,
      rank: 5,
    });
  });

  it('Trio + Single where kicker is a Joker', () => {
    expect(
      identifyHandType(c([5], [5, 'heart'], [5, 'diamond'], [17, 'joker'])),
    ).toEqual({ type: HandType.TrioSingle, rank: 5 });
  });

  // Trio + Pair
  it('Trio + Pair', () => {
    expect(
      identifyHandType(c([5], [5, 'heart'], [5, 'diamond'], [3], [3, 'heart'])),
    ).toEqual({ type: HandType.TrioPair, rank: 5 });
  });

  // Sequence
  it('Sequence: 5 consecutive singles (3→7)', () => {
    expect(identifyHandType(c([3], [4], [5], [6], [7]))).toEqual({
      type: HandType.Sequence,
      rank: 7,
    });
  });

  it('Sequence: 8 cards (5→Q)', () => {
    expect(identifyHandType(c([5], [6], [7], [8], [9], [10], [11], [12]))).toEqual({
      type: HandType.Sequence,
      rank: 12,
    });
  });

  it('Sequence ending at A (rank 14)', () => {
    expect(identifyHandType(c([10], [11], [12], [13], [14]))).toEqual({
      type: HandType.Sequence,
      rank: 14,
    });
  });

  it('Sequence of 4 cards → null (too short)', () => {
    expect(identifyHandType(c([3], [4], [5], [6]))).toBeNull();
  });

  it('Sequence containing 2 (rank 15) → null', () => {
    // J-Q-K-A-2 includes rank 15
    expect(identifyHandType(c([11], [12], [13], [14], [15]))).toBeNull();
  });

  it('Non-consecutive singles → null', () => {
    expect(identifyHandType(c([3], [4], [6], [7], [8]))).toBeNull();
  });

  // Pair Sequence
  it('Pair Sequence: 3 consecutive pairs (3→5)', () => {
    expect(
      identifyHandType(
        c([3], [3, 'heart'], [4], [4, 'heart'], [5], [5, 'heart']),
      ),
    ).toEqual({ type: HandType.PairSequence, rank: 5 });
  });

  it('Pair Sequence: 5 consecutive pairs (5→9)', () => {
    expect(
      identifyHandType(
        c([5],[5,'heart'],[6],[6,'heart'],[7],[7,'heart'],[8],[8,'heart'],[9],[9,'heart']),
      ),
    ).toEqual({ type: HandType.PairSequence, rank: 9 });
  });

  it('Pair Sequence of only 2 pairs → null', () => {
    expect(identifyHandType(c([3], [3, 'heart'], [4], [4, 'heart']))).toBeNull();
  });

  it('Non-consecutive pair sequence → null', () => {
    expect(
      identifyHandType(c([3], [3, 'heart'], [5], [5, 'heart'], [7], [7, 'heart'])),
    ).toBeNull();
  });

  it('Pair Sequence containing 2 (rank 15) → null', () => {
    // K-K-A-A-2-2
    expect(
      identifyHandType(
        c([13], [13, 'heart'], [14], [14, 'heart'], [15], [15, 'heart']),
      ),
    ).toBeNull();
  });

  // Trio Sequence
  it('Trio Sequence (飛機): 2 consecutive trios', () => {
    expect(
      identifyHandType(
        c([3],[3,'heart'],[3,'diamond'],[4],[4,'heart'],[4,'diamond']),
      ),
    ).toEqual({ type: HandType.TrioSequence, rank: 4 });
  });

  it('Trio Sequence: 3 consecutive trios (5→7)', () => {
    expect(
      identifyHandType(
        c(
          [5],[5,'heart'],[5,'diamond'],
          [6],[6,'heart'],[6,'diamond'],
          [7],[7,'heart'],[7,'diamond'],
        ),
      ),
    ).toEqual({ type: HandType.TrioSequence, rank: 7 });
  });

  it('Non-consecutive trios → null', () => {
    expect(
      identifyHandType(
        c([3],[3,'heart'],[3,'diamond'],[5],[5,'heart'],[5,'diamond']),
      ),
    ).toBeNull();
  });

  it('Trio Sequence containing 2 → null', () => {
    // A-A-A-2-2-2 = ranks [14,14,14,15,15,15]
    expect(
      identifyHandType(
        c([14],[14,'heart'],[14,'diamond'],[15],[15,'heart'],[15,'diamond']),
      ),
    ).toBeNull();
  });

  // Trio Sequence + Singles
  it('Trio Seq + Singles: 2 trios + 2 singles', () => {
    expect(
      identifyHandType(
        c([3],[3,'heart'],[3,'diamond'],[4],[4,'heart'],[4,'diamond'],[7],[8]),
      ),
    ).toEqual({ type: HandType.TrioSeqSingles, rank: 4 });
  });

  it('Trio Seq + Singles: 3 trios + 3 singles', () => {
    expect(
      identifyHandType(
        c(
          [5],[5,'heart'],[5,'diamond'],
          [6],[6,'heart'],[6,'diamond'],
          [7],[7,'heart'],[7,'diamond'],
          [3],[4],[9],
        ),
      ),
    ).toEqual({ type: HandType.TrioSeqSingles, rank: 7 });
  });

  it('Trio Seq + Singles: kicker can be a Joker', () => {
    expect(
      identifyHandType(
        c([3],[3,'heart'],[3,'diamond'],[4],[4,'heart'],[4,'diamond'],[17,'joker'],[8]),
      ),
    ).toEqual({ type: HandType.TrioSeqSingles, rank: 4 });
  });

  // Trio Sequence + Pairs
  it('Trio Seq + Pairs: 2 trios + 2 pairs', () => {
    expect(
      identifyHandType(
        c(
          [3],[3,'heart'],[3,'diamond'],
          [4],[4,'heart'],[4,'diamond'],
          [7],[7,'heart'],
          [8],[8,'heart'],
        ),
      ),
    ).toEqual({ type: HandType.TrioSeqPairs, rank: 4 });
  });

  // Quad + 2 Singles
  it('Quad + 2 Singles', () => {
    expect(
      identifyHandType(c([5],[5,'heart'],[5,'diamond'],[5,'club'],[3],[8])),
    ).toEqual({ type: HandType.QuadSingles, rank: 5 });
  });

  it('Quad + 2 Singles with Joker kicker', () => {
    expect(
      identifyHandType(
        c([5],[5,'heart'],[5,'diamond'],[5,'club'],[3],[17,'joker']),
      ),
    ).toEqual({ type: HandType.QuadSingles, rank: 5 });
  });

  // Quad + 2 Pairs
  it('Quad + 2 Pairs', () => {
    expect(
      identifyHandType(
        c([5],[5,'heart'],[5,'diamond'],[5,'club'],[3],[3,'heart'],[8],[8,'heart']),
      ),
    ).toEqual({ type: HandType.QuadPairs, rank: 5 });
  });

  // Bomb
  it('Bomb: four of a kind', () => {
    expect(
      identifyHandType(c([5],[5,'heart'],[5,'diamond'],[5,'club'])),
    ).toEqual({ type: HandType.Bomb, rank: 5 });
  });

  it('Bomb of 2s (rank 15)', () => {
    expect(
      identifyHandType(c([15],[15,'heart'],[15,'diamond'],[15,'club'])),
    ).toEqual({ type: HandType.Bomb, rank: 15 });
  });

  // Rocket
  it('Rocket: both Jokers', () => {
    expect(identifyHandType(c([16,'joker'],[17,'joker']))).toEqual({
      type: HandType.Rocket,
      rank: 17,
    });
  });

  // Invalid
  it('Random invalid combo → null', () => {
    expect(identifyHandType(c([3],[4],[4],[7],[8]))).toBeNull();
  });

  it('Two pairs (four cards, two different ranks) → null', () => {
    // Not a valid Dou Di Zhu hand
    expect(identifyHandType(c([3],[3,'heart'],[4],[4,'heart']))).toBeNull();
  });
});

// ── validatePlay ──────────────────────────────────────────────────────────────

describe('validatePlay', () => {
  it('valid hand on new round returns a Play', () => {
    const result = validatePlay(c([3],[4],[5],[6],[7]), null);
    expect(result).not.toBeNull();
    expect(result?.type).toBe(HandType.Sequence);
    expect(result?.rank).toBe(7);
  });

  it('invalid hand on new round → null', () => {
    expect(validatePlay(c([3],[5]), null)).toBeNull();
  });

  it('higher pair beats lower pair', () => {
    const last = { type: HandType.Pair, cards: c([5],[5,'heart']), rank: 5 };
    const result = validatePlay(c([7],[7,'heart']), last);
    expect(result).not.toBeNull();
    expect(result?.rank).toBe(7);
  });

  it('lower pair cannot beat higher pair', () => {
    const last = { type: HandType.Pair, cards: c([7],[7,'heart']), rank: 7 };
    expect(validatePlay(c([5],[5,'heart']), last)).toBeNull();
  });

  it('equal rank → null', () => {
    const last = { type: HandType.Pair, cards: c([7],[7,'heart']), rank: 7 };
    expect(validatePlay(c([7,'diamond'],[7,'club']), last)).toBeNull();
  });

  it('pair cannot follow sequence', () => {
    const last = {
      type: HandType.Sequence,
      cards: c([3],[4],[5],[6],[7]),
      rank: 7,
    };
    expect(validatePlay(c([9],[9,'heart']), last)).toBeNull();
  });

  it('bomb beats a pair', () => {
    const last = { type: HandType.Pair, cards: c([13],[13,'heart']), rank: 13 };
    const result = validatePlay(c([3],[3,'heart'],[3,'diamond'],[3,'club']), last);
    expect(result?.type).toBe(HandType.Bomb);
  });

  it('bomb beats a sequence', () => {
    const last = {
      type: HandType.Sequence,
      cards: c([3],[4],[5],[6],[7]),
      rank: 7,
    };
    const result = validatePlay(c([3],[3,'heart'],[3,'diamond'],[3,'club']), last);
    expect(result?.type).toBe(HandType.Bomb);
  });

  it('higher bomb beats lower bomb', () => {
    const last = {
      type: HandType.Bomb,
      cards: c([5],[5,'heart'],[5,'diamond'],[5,'club']),
      rank: 5,
    };
    const result = validatePlay(
      c([14],[14,'heart'],[14,'diamond'],[14,'club']),
      last,
    );
    expect(result).not.toBeNull();
    expect(result?.type).toBe(HandType.Bomb);
  });

  it('lower bomb cannot beat higher bomb', () => {
    const last = {
      type: HandType.Bomb,
      cards: c([14],[14,'heart'],[14,'diamond'],[14,'club']),
      rank: 14,
    };
    expect(
      validatePlay(c([5],[5,'heart'],[5,'diamond'],[5,'club']), last),
    ).toBeNull();
  });

  it('rocket beats a bomb', () => {
    const last = {
      type: HandType.Bomb,
      cards: c([14],[14,'heart'],[14,'diamond'],[14,'club']),
      rank: 14,
    };
    const result = validatePlay(c([16,'joker'],[17,'joker']), last);
    expect(result?.type).toBe(HandType.Rocket);
  });

  it('nothing can beat a rocket', () => {
    const last = {
      type: HandType.Rocket,
      cards: c([16,'joker'],[17,'joker']),
      rank: 17,
    };
    expect(
      validatePlay(c([14],[14,'heart'],[14,'diamond'],[14,'club']), last),
    ).toBeNull();
  });

  it('sequence different length → null', () => {
    const last = {
      type: HandType.Sequence,
      cards: c([3],[4],[5],[6],[7]),
      rank: 7,
    };
    // 6-card sequence vs 5-card last play
    expect(validatePlay(c([4],[5],[6],[7],[8],[9]), last)).toBeNull();
  });

  it('sequence same length and higher rank → valid', () => {
    const last = {
      type: HandType.Sequence,
      cards: c([3],[4],[5],[6],[7]),
      rank: 7,
    };
    const result = validatePlay(c([4],[5],[6],[7],[8]), last);
    expect(result).not.toBeNull();
    expect(result?.rank).toBe(8);
  });

  it('pair sequence: same length higher rank → valid', () => {
    const last = {
      type: HandType.PairSequence,
      cards: c([3],[3,'heart'],[4],[4,'heart'],[5],[5,'heart']),
      rank: 5,
    };
    const result = validatePlay(
      c([6],[6,'heart'],[7],[7,'heart'],[8],[8,'heart']),
      last,
    );
    expect(result?.rank).toBe(8);
  });
});
