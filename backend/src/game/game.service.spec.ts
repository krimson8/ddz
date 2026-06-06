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

  // ── 抽地主 (role-card draw) ──────────────────────────────────────────────────

  function startNoVolunteerRoleDraw(): Room {
    const room = seedRoom(3);
    svc.handleVotePlay('s-a');
    svc.handleVotePlay('s-b');
    svc.handleVotePlay('s-c');
    advanceToBidding(room);
    // Everyone passes → nobody volunteers → 抽地主 opens instead of random.
    svc.handleBid('s-a', 0);
    svc.handleBid('s-b', 0);
    svc.handleBid('s-c', 0);
    return room;
  }

  it('opens the 抽地主 draw (no landlord yet) when nobody volunteers', () => {
    const room = startNoVolunteerRoleDraw();
    expect(room.landlordIndex).toBe(-1);
    expect(room.roleDrawActive).toBe(true);
    expect(room.roleDeck).toHaveLength(3);
    expect(room.roleDeck.filter((r) => r === 'landlord')).toHaveLength(1);
    expect(emitted.some((e) => e.event === 'role_draw_open')).toBe(true);
  });

  it('locks instantly when 地主 is the very first pick and deals after a 3s reveal', () => {
    const room = startNoVolunteerRoleDraw();
    const landlordSlot = room.roleDeck.findIndex((r) => r === 'landlord');

    // a draws 地主 as the FIRST pick → outcome known, locks immediately even
    // though only one card is down. The other two are 農民 anyway.
    svc.handleRolePick('s-a', landlordSlot);

    expect(room.roleDrawLocked).toBe(true);
    expect(room.roleDrawActive).toBe(true); // screen stays up until dealt
    expect(room.rolePicks.filter((p) => p !== null)).toHaveLength(1); // only 1 drawn
    expect(room.landlordIndex).toBe(-1);
    expect(emitted.some((e) => e.event === 'role_draw_locked')).toBe(true);

    jest.advanceTimersByTime(3_000);

    expect(room.landlordIndex).toBe(0);
    const landlord = room.members.find((m) => m.uid === room.playerUids[0])!;
    expect(landlord.hand).toHaveLength(20); // 17 + 3 landlord cards
    expect(totalCards(room)).toBe(54);
  });

  it('determines the landlord by elimination when both 農民 are drawn first', () => {
    const room = startNoVolunteerRoleDraw();
    const landlordSlot = room.roleDeck.findIndex((r) => r === 'landlord');
    const peasantSlots = [0, 1, 2].filter((s) => s !== landlordSlot);

    // a & b take both 農民 → the leftover 地主 slot belongs to c (index 2).
    svc.handleRolePick('s-a', peasantSlots[0]);
    svc.handleRolePick('s-b', peasantSlots[1]);

    expect(room.roleDrawLocked).toBe(true);
    expect(room.rolePicks[landlordSlot]).toBeNull(); // 地主 card never tapped

    jest.advanceTimersByTime(3_000);

    expect(room.landlordIndex).toBe(2); // c, by elimination
  });

  it('ignores picks after the draw is locked (leftover flip is for-fun only)', () => {
    const room = startNoVolunteerRoleDraw();
    const landlordSlot = room.roleDeck.findIndex((r) => r === 'landlord');
    const peasantSlots = [0, 1, 2].filter((s) => s !== landlordSlot);

    svc.handleRolePick('s-a', peasantSlots[0]);
    svc.handleRolePick('s-b', peasantSlots[1]); // locks here
    svc.handleRolePick('s-c', landlordSlot); // late tap on leftover → ignored

    expect(room.rolePicks[landlordSlot]).toBeNull();

    jest.advanceTimersByTime(3_000);
    expect(room.landlordIndex).toBe(2); // still c by elimination
  });

  it('reveals each picked card to the room as it is taken', () => {
    const room = startNoVolunteerRoleDraw();
    svc.handleRolePick('s-a', 0);
    const ev = emitted.find((e) => e.event === 'role_picked');
    expect(ev).toBeTruthy();
    expect(ev!.payload).toMatchObject({
      slotIndex: 0,
      playerIndex: 0,
      role: room.roleDeck[0],
      pickedCount: 1,
    });
  });

  it('rejects a pick of an already-taken slot', () => {
    const room = startNoVolunteerRoleDraw();
    svc.handleRolePick('s-a', 0);
    svc.handleRolePick('s-b', 0); // slot 0 is taken → ignored
    expect(room.rolePicks[0]).toBe(0); // still a's
    expect(room.rolePicks[1]).toBeNull();
    expect(room.rolePicks[2]).toBeNull();
  });

  it('prevents a player from claiming a second card', () => {
    const room = startNoVolunteerRoleDraw();
    svc.handleRolePick('s-a', 0);
    svc.handleRolePick('s-a', 1); // a already picked → ignored
    expect(room.rolePicks[1]).toBeNull();
    expect(room.rolePicks.filter((p) => p === 0)).toHaveLength(1);
  });
});
