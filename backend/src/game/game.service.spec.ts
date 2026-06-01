import { GameService } from './game.service';
import { RoomManager } from './room.manager';
import type { LeaderboardService } from '../leaderboard/leaderboard.service';
import type { AuthedUser } from '../auth/auth.service';
import type { Room } from './types';

/**
 * These tests lock in the idempotency guards that prevent the two start-flow
 * races we hit in production:
 *   1. A 4th player voting during the dealing countdown → double startGame →
 *      duplicate deck deal (17+20+20 / 17+26+17 card counts, wrong player set).
 *   2. The 3rd bid racing the 8s bid-timer → double finalizeBidding → landlord
 *      cards pushed twice (23-card landlord hand).
 */
describe('GameService — start-flow idempotency', () => {
  let rm: RoomManager;
  let svc: GameService;
  // Captures every (event, payload) emitted, so tests can assert on broadcasts.
  let emitted: Array<{ event: string; payload: unknown }>;

  /** Minimal Server stub: records emits, and exposes an empty lobby adapter. */
  function makeServerStub() {
    const emit = (event: string, payload: unknown) => {
      emitted.push({ event, payload });
    };
    return {
      to: () => ({ emit }),
      sockets: {
        // broadcastRoomList reads adapter.rooms.get(LOBBY_ROOM) — empty = no-op.
        adapter: { rooms: new Map<string, Set<string>>() },
        sockets: new Map(),
      },
    };
  }

  const leaderboardStub = {
    recordResult: jest.fn().mockResolvedValue(undefined),
  } as unknown as LeaderboardService;

  function user(uid: string): AuthedUser {
    return { uid, email: `${uid}@x`, nickname: uid, avatarUrl: null };
  }

  /** Create a room with N spectators (uid 'a','b','c',… socketId 's-a',…). */
  function seedRoom(n: number): Room {
    const owner = user('a');
    const res = svc.handleCreateRoom(owner, 's-a');
    if ('error' in res) throw new Error(res.error);
    const code = res.roomCode;
    for (let i = 1; i < n; i++) {
      const uid = String.fromCharCode(97 + i); // b, c, d, e
      const join = svc.handleJoinRoom(user(uid), code, `s-${uid}`);
      if ('error' in join) throw new Error(join.error);
    }
    return rm.getRoom(code)!;
  }

  function totalCards(room: Room): number {
    return room.playerUids.reduce((sum, uid) => {
      const m = room.members.find((mem) => mem.uid === uid);
      return sum + (m ? m.hand.length : 0);
    }, 0);
  }

  beforeEach(() => {
    jest.useFakeTimers();
    emitted = [];
    rm = new RoomManager();
    svc = new GameService(rm, leaderboardStub);
    svc.setServer(makeServerStub() as never);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  // ── startGame / vote race ───────────────────────────────────────────────────

  it('locks the room to "starting" the instant a 3rd vote arrives', () => {
    const room = seedRoom(5);
    svc.handleVotePlay('s-a');
    svc.handleVotePlay('s-b');
    expect(room.state).toBe('waiting');
    svc.handleVotePlay('s-c');
    expect(room.state).toBe('starting');
  });

  it('rejects a 4th vote during the dealing countdown and keeps the original 3 players', () => {
    const room = seedRoom(5);
    svc.handleVotePlay('s-a');
    svc.handleVotePlay('s-b');
    svc.handleVotePlay('s-c'); // → starting, players locked to [a,b,c]

    expect(room.playerUids).toEqual(['a', 'b', 'c']);

    // Player d races a vote in during the 3s countdown — must be rejected.
    svc.handleVotePlay('s-d');

    expect(room.members.find((m) => m.uid === 'd')!.wantToPlay).toBe(false);
    expect(room.playerUids).toEqual(['a', 'b', 'c']);
  });

  it('deals exactly one deck (17+17+17 + 3 landlord) even if startGame is re-entered', () => {
    const room = seedRoom(5);
    svc.handleVotePlay('s-a');
    svc.handleVotePlay('s-b');
    svc.handleVotePlay('s-c');

    // Simulate a duplicate start attempt (the bug: a second scheduled start).
    (svc as unknown as { startGame(r: Room): void }).startGame(room);

    // Run the 3s countdown → the single startBiddingRound deals the deck.
    jest.advanceTimersByTime(3_000);

    expect(room.state).toBe('playing');
    const counts = room.playerUids.map(
      (uid) => room.members.find((m) => m.uid === uid)!.hand.length,
    );
    expect(counts).toEqual([17, 17, 17]);
    expect(room.landlordCards).toHaveLength(3);
    expect(totalCards(room)).toBe(51); // 54 − 3 landlord cards
  });

  it('aborts to the lobby if a locked-in player vanishes during the countdown', () => {
    const room = seedRoom(3);
    svc.handleVotePlay('s-a');
    svc.handleVotePlay('s-b');
    svc.handleVotePlay('s-c'); // → starting

    // Player c disconnects before dealing. Not yet 'playing', so this splices.
    svc.handleDisconnect('s-c');

    jest.advanceTimersByTime(3_000);

    expect(room.state).toBe('waiting');
    expect(room.playerUids).toEqual([]);
  });

  // ── finalizeBidding race ──────────────────────────────────────────────────────

  /** Fast-forward a freshly-locked room through dealing into the bidding window. */
  function advanceToBidding(room: Room): void {
    jest.advanceTimersByTime(3_000); // dealing countdown → startBiddingRound
    jest.advanceTimersByTime(2_000); // internal delay → bid_open + bidTimer armed
  }

  it('chooses the landlord once even when the 3rd bid races the bid timer', () => {
    const room = seedRoom(3);
    svc.handleVotePlay('s-a');
    svc.handleVotePlay('s-b');
    svc.handleVotePlay('s-c');
    advanceToBidding(room);

    expect(room.state).toBe('playing');
    expect(room.landlordIndex).toBe(-1);

    // One volunteer + two passes — the 3rd bid triggers finalizeBidding inline.
    svc.handleBid('s-a', 1);
    svc.handleBid('s-b', 0);
    svc.handleBid('s-c', 0);

    expect(room.landlordIndex).toBeGreaterThanOrEqual(0);
    const landlordUid = room.playerUids[room.landlordIndex];
    const landlord = room.members.find((m) => m.uid === landlordUid)!;
    expect(landlord.hand).toHaveLength(20); // 17 + 3 landlord cards

    // Now let the 8s bid timer fire — it must be a no-op (already finalized).
    jest.advanceTimersByTime(8_000);
    expect(landlord.hand).toHaveLength(20); // NOT 23
    expect(totalCards(room)).toBe(54);
  });

  it('finalizeBidding is a no-op once a landlord is set', () => {
    const room = seedRoom(3);
    svc.handleVotePlay('s-a');
    svc.handleVotePlay('s-b');
    svc.handleVotePlay('s-c');
    advanceToBidding(room);

    svc.handleBid('s-a', 1);
    svc.handleBid('s-b', 0);
    svc.handleBid('s-c', 0);

    const landlordIndex = room.landlordIndex;
    const landlordUid = room.playerUids[landlordIndex];
    const before = room.members.find((m) => m.uid === landlordUid)!.hand.length;

    // Direct re-entry (the race we guard against).
    (svc as unknown as { finalizeBidding(r: Room): void }).finalizeBidding(room);

    expect(room.landlordIndex).toBe(landlordIndex);
    const after = room.members.find((m) => m.uid === landlordUid)!.hand.length;
    expect(after).toBe(before);
    expect(totalCards(room)).toBe(54);
  });

  // ── 黑白 tiebreak ──────────────────────────────────────────────────────────────

  function startNoVolunteerCoinflip(): Room {
    const room = seedRoom(3);
    svc.handleVotePlay('s-a');
    svc.handleVotePlay('s-b');
    svc.handleVotePlay('s-c');
    advanceToBidding(room);
    // Everyone passes → nobody volunteers → 黑白 vote opens instead of random.
    svc.handleBid('s-a', 0);
    svc.handleBid('s-b', 0);
    svc.handleBid('s-c', 0);
    return room;
  }

  it('opens the 黑白 vote (no landlord yet) when nobody volunteers', () => {
    const room = startNoVolunteerCoinflip();
    expect(room.landlordIndex).toBe(-1);
    expect(room.coinflipActive).toBe(true);
    expect(emitted.some((e) => e.event === 'coinflip_open')).toBe(true);
  });

  it('makes the lone (1-vs-2) voter the landlord', () => {
    const room = startNoVolunteerCoinflip();
    // a = white, b,c = black → a is the minority → a (index 0) is landlord.
    svc.handleCoinVote('s-a', 'white');
    svc.handleCoinVote('s-b', 'black');
    svc.handleCoinVote('s-c', 'black');

    expect(room.landlordIndex).toBe(0);
    expect(room.coinflipActive).toBe(false);
    const landlord = room.members.find((m) => m.uid === room.playerUids[0])!;
    expect(landlord.hand).toHaveLength(20); // 17 + 3 landlord cards
    expect(totalCards(room)).toBe(54);
  });

  it('restarts the 黑白 vote when all three pick the same colour', () => {
    const room = startNoVolunteerCoinflip();
    svc.handleCoinVote('s-a', 'white');
    svc.handleCoinVote('s-b', 'white');
    svc.handleCoinVote('s-c', 'white');

    // No minority → still no landlord, vote re-opened, tallies cleared.
    expect(room.landlordIndex).toBe(-1);
    expect(room.coinflipActive).toBe(true);
    expect(room.coinVotedIndices).toEqual([]);

    // A fresh decisive round resolves it.
    svc.handleCoinVote('s-a', 'black');
    svc.handleCoinVote('s-b', 'white');
    svc.handleCoinVote('s-c', 'white');
    expect(room.landlordIndex).toBe(0);
  });

  it('ignores a duplicate 黑白 vote (locked once cast)', () => {
    const room = startNoVolunteerCoinflip();
    svc.handleCoinVote('s-a', 'white');
    svc.handleCoinVote('s-a', 'black'); // duplicate — must be ignored
    expect(room.coinVotedIndices).toEqual([0]);
    expect(room.coinVotes[0]).toBe('white');
    expect(room.landlordIndex).toBe(-1); // still waiting on b & c
  });
});
