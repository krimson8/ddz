import { Injectable } from '@nestjs/common';
import { Server } from 'socket.io';
import { createDeck, shuffle, sortHand, validatePlay } from './card.utils';
import { RoomManager } from './room.manager';
import { Card, HandType, Member, Room } from './types';
import type { AuthedUser } from '../auth/auth.service';
import { LeaderboardService } from '../leaderboard/leaderboard.service';

const TURN_TIMEOUT_MS = 30_000;
const RECONNECT_GRACE_MS = 30_000;

/** Socket.io room name used to broadcast lobby updates to all not-yet-in-a-room sockets. */
export const LOBBY_ROOM = '__lobby';

// ── Public return types used by the gateway ──────────────────────────────────

export interface JoinResult {
  roomCode: string;
  nickname: string;
}

// ── GameService ──────────────────────────────────────────────────────────────

/**
 * Central state machine for the Dou Di Zhu game.
 *
 * Identity model:
 *  - All members are identified by uid (Firebase UID). Sockets rotate but uid is stable.
 *  - A uid may belong to at most one room at a time (enforced in handleCreateRoom/handleJoinRoom).
 *  - Disconnects splice the member immediately. No reconnect grace window.
 *  - Empty rooms are killed immediately on last disconnect.
 *
 * Event-emission contract with the gateway:
 *  - The gateway must call `socket.join(roomCode)` *before* calling handleCreateRoom/handleJoinRoom
 *    so that future room-wide broadcasts reach the new socket.
 *  - The gateway calls `setServer(server)` inside `afterInit()`.
 *  - All other handle* methods are called directly from @SubscribeMessage handlers.
 */
@Injectable()
export class GameService {
  private server!: Server;

  constructor(
    private readonly roomManager: RoomManager,
    private readonly leaderboardService: LeaderboardService,
  ) {}

  setServer(server: Server): void {
    this.server = server;
  }

  // ── Broadcast helpers ───────────────────────────────────────────────────────

  /** Broadcast to every socket in the room, appending the room's seq number. */
  private emitToRoom(room: Room, event: string, payload: object): void {
    room.eventSeq += 1;
    this.server?.to(room.code).emit(event, { ...payload, seq: room.eventSeq });
  }

  /**
   * Broadcast the canonical gameplay state to the whole room, then unicast
   * the current player's hand to them privately.
   */
  private buildGameStatePayload(room: Room): object {
    return {
      // currentPlayer is the uid of whoever's turn it is (or null)
      currentPlayer: room.playerUids[room.currentTurn] ?? null,
      currentPlayerEndTime: room.turnEndTime,
      onTable: room.lastPlay,
      history: room.playHistory,
      playerCardCounts: room.playerUids.map((uid) => {
        const m = room.members.find((mem) => mem.uid === uid);
        return m ? m.hand.length : 0;
      }),
      landlordIndex: room.landlordIndex,
      landlordCards: room.landlordCards,
      playerHands: room.playerUids.map((uid) => {
        const m = room.members.find((mem) => mem.uid === uid);
        return m ? m.hand : [];
      }),
      surrendered: [...room.surrendered],
      phase: 'gameplay',
    };
  }

  /** Unicast a game_state snapshot to a single socket. */
  private emitGameStateToSocket(room: Room, socketId: string): void {
    this.server?.to(socketId).emit('game_state', this.buildGameStatePayload(room));
  }

  /** Broadcast game_state to the room, then unicast each player's hand. */
  private emitGameState(room: Room): void {
    // Plays, passes, and any gameplay turn change cancel a pending landlord
    // surrender — clear it BEFORE building the payload so the broadcast carries
    // the post-clear `surrendered` array (avoids a transient mismatch).
    this.clearLandlordPendingSurrender(room);
    this.emitToRoom(room, 'game_state', this.buildGameStatePayload(room));
    for (let i = 0; i < 3; i++) {
      const uid = room.playerUids[i];
      const m = room.members.find((mem) => mem.uid === uid);
      if (m) this.emitToSocket(m.socketId, 'hand_updated', { hand: m.hand });
    }
  }

  /**
   * Build the member list payload for clients.
   * `id` is set to uid for backward-compat with the existing frontend; subsequent
   * commits will update the frontend to consume `uid` directly.
   */
  private serializeMembers(room: Room) {
    return room.members.map((m) => ({
      id: m.uid, // backward-compat: frontend uses `id` to identify a member
      uid: m.uid,
      nickname: m.nickname,
      avatarUrl: m.avatarUrl,
      role: m.role,
      cardCount: m.hand.length,
      wantToPlay: m.wantToPlay,
    }));
  }

  /**
   * Any meaningful room activity (play, pass, bid, member change, profile edit,
   * etc.) cancels the landlord's pending surrender confirmation — they must
   * re-press to commit. Peasant toggles persist.
   * Returns true if a broadcast was sent.
   */
  private clearLandlordPendingSurrender(room: Room): boolean {
    if (
      room.landlordIndex === -1 ||
      !room.surrendered.includes(room.landlordIndex)
    ) {
      return false;
    }
    room.surrendered = room.surrendered.filter(
      (i) => i !== room.landlordIndex,
    );
    this.emitToRoom(room, 'surrender_update', {
      surrendered: [...room.surrendered],
    });
    return true;
  }

  /** Broadcast the full member list to the room. */
  private emitMembersUpdate(room: Room): void {
    this.clearLandlordPendingSurrender(room);
    const members = this.serializeMembers(room);
    const readyCount = members.filter((m) => m.wantToPlay).length;
    const canVote = room.state === 'waiting';
    this.emitToRoom(room, 'members_update', { members, readyCount, canVote });
  }

  /** Unicast to a single socket — no seq (point-to-point, not room-level). */
  private emitToSocket(socketId: string, event: string, payload: object): void {
    this.server?.to(socketId).emit(event, payload);
  }

  // ── Room creation / joining ─────────────────────────────────────────────────

  /**
   * Create a new room with the authenticated user as the sole spectator.
   * Rejects if the user is already in any room (one-room-per-uid rule).
   */
  handleCreateRoom(
    user: AuthedUser,
    socketId: string,
  ): JoinResult | { error: string } {
    if (this.roomManager.getRoomByUid(user.uid)) {
      return { error: '你已在一個房間中，無法建立新房間' };
    }
    if (this.roomManager.roomCount >= 500) {
      return { error: '伺服器已達到最大房間數，請稍後再試' };
    }

    const room = this.roomManager.createRoom(
      user.uid,
      user.nickname,
      user.avatarUrl,
      socketId,
    );

    this.broadcastRoomList();
    return { roomCode: room.code, nickname: user.nickname };
  }

  /**
   * Join an existing room as a spectator.
   * Rejects if the user is already in any room.
   */
  handleJoinRoom(
    user: AuthedUser,
    code: string,
    socketId: string,
  ): JoinResult | { error: string } {
    const upperCode = code.toUpperCase().trim();
    if (!/^[A-Z2-9]{6}$/.test(upperCode)) {
      return { error: '無效的房間代碼' };
    }

    const room = this.roomManager.getRoom(upperCode);
    if (!room) {
      return { error: '找不到房間' };
    }

    // One-room-per-uid: reject if already in a different room
    const existingRoom = this.roomManager.getRoomByUid(user.uid);
    if (existingRoom && existingRoom.code !== upperCode) {
      return { error: '你已在另一個房間中' };
    }
    // If somehow already in this room (shouldn't happen — connection-time guard),
    // just return success so the gateway re-sends state.
    if (existingRoom && existingRoom.code === upperCode) {
      return { roomCode: upperCode, nickname: user.nickname };
    }

    if (room.members.length >= 10) {
      return { error: '房間人數已滿（最多 10 人）' };
    }

    const result = this.roomManager.joinRoom(
      upperCode,
      user.uid,
      user.nickname,
      user.avatarUrl,
      socketId,
    );
    if (!result) {
      return { error: '加入房間失敗' };
    }

    // Broadcast updated member list to existing members
    this.emitMembersUpdate(room);
    this.broadcastRoomList();

    return { roomCode: upperCode, nickname: user.nickname };
  }

  // ── Voting ──────────────────────────────────────────────────────────────────

  /**
   * Toggle a member's intent to play. When exactly 3 members have flagged
   * wantToPlay, the game starts immediately.
   */
  handleVotePlay(socketId: string): void {
    const room = this.roomManager.getRoomBySocketId(socketId);
    if (!room) return;

    // Votes are only accepted in the lobby. Once the 3rd vote flips the room
    // into `starting`, the start flow owns the player set — any further vote
    // (e.g. a 4th player racing in during the dealing countdown) is rejected.
    if (room.state !== 'waiting' || room.resultPending) {
      this.server?.to(socketId).emit('room_error', { message: '遊戲進行中，無法投票' });
      return;
    }

    const member = room.members.find((m) => m.socketId === socketId);
    if (!member) return;

    member.wantToPlay = !member.wantToPlay;

    const voters = room.members.filter((m) => m.wantToPlay);
    if (voters.length >= 3) {
      // Flip the lock BEFORE any broadcast or async hop so a concurrently
      // queued vote_play can never observe `waiting` and re-enter startGame.
      this.startGame(room);
      return;
    }

    this.emitMembersUpdate(room);
  }

  // ── Bidding ─────────────────────────────────────────────────────────────────

  handleBid(socketId: string, value: 0 | 1): void {
    const room = this.roomManager.getRoomBySocketId(socketId);
    if (!room || room.state !== 'playing' || room.landlordIndex !== -1) {
      this.server
        ?.to(socketId)
        .emit('room_error', { message: '現在不是叫地主階段' });
      return;
    }

    const member = room.members.find((m) => m.socketId === socketId);
    if (!member) return;
    const playerIndex = room.playerUids.indexOf(member.uid);
    if (playerIndex === -1) return; // spectator

    if (room.bidVotedIndices.includes(playerIndex)) return;
    room.bidVotedIndices.push(playerIndex);

    if (value === 1) {
      room.bidYesVoters.push(playerIndex);
    }
    room.bidPassCount++;

    this.emitToRoom(room, 'bid_made', { playerIndex, value, votedCount: room.bidPassCount });

    if (room.bidPassCount >= 3) {
      this.finalizeBidding(room);
    }
  }

  // ── Gameplay ─────────────────────────────────────────────────────────────────

  handlePlayCards(socketId: string, cards: Card[]): void {
    const room = this.roomManager.getRoomBySocketId(socketId);
    if (!room || room.state !== 'playing' || room.landlordIndex === -1) {
      this.server
        ?.to(socketId)
        .emit('room_error', { message: '現在不是出牌階段' });
      return;
    }

    const member = room.members.find((m) => m.socketId === socketId);
    if (!member) return;
    const playerIndex = room.playerUids.indexOf(member.uid);
    if (playerIndex === -1) return; // spectator

    if (playerIndex !== room.currentTurn) {
      this.server?.to(socketId).emit('room_error', { message: '還不是你的回合' });
      return;
    }

    // Verify every submitted card is actually in the player's hand
    const handCopy = [...member.hand];
    const playCards: Card[] = [];
    for (const c of cards) {
      const idx = handCopy.findIndex(
        (h) => h.suit === c.suit && h.rank === c.rank,
      );
      if (idx === -1) {
        this.server
          ?.to(socketId)
          .emit('invalid_play', { reason: '你沒有這些牌' });
        return;
      }
      playCards.push(handCopy[idx]);
      handCopy.splice(idx, 1);
    }

    const result = validatePlay(playCards, room.lastPlay);
    if (!result) {
      this.server?.to(socketId).emit('invalid_play', { reason: '無效的出牌' });
      return;
    }

    member.hand = handCopy;
    room.lastPlay = result;
    room.lastPlayedBy = playerIndex;
    room.passCount = 0;
    room.playHistory.push({ playerIndex, play: result });

    if (member.hand.length === 0) {
      const winner =
        playerIndex === room.landlordIndex ? 'landlord' : 'peasants';
      this.handleWin(room, winner);
      return;
    }

    const nextTurn = (room.currentTurn + 1) % 3;
    room.currentTurn = nextTurn;
    this.startTurnTimer(room, nextTurn);
    this.emitGameState(room);
  }

  /**
   * Handle a surrender toggle from a player.
   * Both landlord and peasants toggle in/out of `room.surrendered` — this broadcasts
   * `surrender_update` so all clients (players + spectators) can render the
   * pending blink on the corresponding avatar.
   *
   * Loss conditions:
   *  - Landlord toggled in twice consecutively (i.e. second press while still in
   *    the set) → landlord loses immediately. The first press only sets the
   *    blink; the second press finalizes.
   *  - Both peasants simultaneously in the set → landlord wins.
   */
  handleSurrender(socketId: string): void {
    const room = this.roomManager.getRoomBySocketId(socketId);
    if (!room || room.state !== 'playing' || room.landlordIndex === -1) {
      return;
    }
    const member = room.members.find((m) => m.socketId === socketId);
    if (!member) return;
    const playerIndex = room.playerUids.indexOf(member.uid);
    if (playerIndex === -1) return; // spectator

    const isLandlord = playerIndex === room.landlordIndex;
    const alreadyFlagged = room.surrendered.includes(playerIndex);

    if (isLandlord && alreadyFlagged) {
      // Landlord pressed again → finalize: peasants win
      room.playHistory.push({
        playerIndex,
        play: { type: HandType.Single, cards: [], rank: 0 },
        surrender: true,
      });
      this.handleWin(room, 'peasants', 'surrender');
      return;
    }

    // Toggle (any role): adds on first press, removes on second press (peasant only;
    // landlord's second press is handled above as the finalize path).
    const idx = room.surrendered.indexOf(playerIndex);
    if (idx === -1) {
      room.surrendered.push(playerIndex);
    } else {
      room.surrendered.splice(idx, 1);
    }
    this.emitToRoom(room, 'surrender_update', { surrendered: [...room.surrendered] });

    // Peasant loss check: both peasants currently flagged → landlord wins
    if (!isLandlord) {
      const peasantIndices = [0, 1, 2].filter((i) => i !== room.landlordIndex);
      const bothSurrendered = peasantIndices.every((i) => room.surrendered.includes(i));
      if (bothSurrendered) {
        for (const pi of peasantIndices) {
          room.playHistory.push({
            playerIndex: pi,
            play: { type: HandType.Single, cards: [], rank: 0 },
            surrender: true,
          });
        }
        this.handleWin(room, 'landlord', 'surrender');
      }
    }
  }

  handlePass(socketId: string): void {
    const room = this.roomManager.getRoomBySocketId(socketId);
    if (!room || room.state !== 'playing' || room.landlordIndex === -1) {
      return;
    }

    const member = room.members.find((m) => m.socketId === socketId);
    if (!member) return;
    const playerIndex = room.playerUids.indexOf(member.uid);
    if (playerIndex === -1 || playerIndex !== room.currentTurn) return;

    room.passCount++;

    if (room.passCount >= 2) {
      room.passCount = 0;
      room.lastPlay = null;
      room.currentTurn = room.lastPlayedBy;
    } else {
      room.currentTurn = (room.currentTurn + 1) % 3;
    }
    this.startTurnTimer(room, room.currentTurn);
    this.emitGameState(room);
  }

  // ── Disconnect / leave ──────────────────────────────────────────────────────

  /**
   * Explicit leave_room from the client — immediate splice (no reconnect grace).
   * The round is aborted only if the leaver was an active player mid-game; a
   * spectator leaving just updates the member list and the game continues.
   * See removeSocketFromRoom for the conditional reset.
   */
  handleLeaveRoom(socketId: string): void {
    this.removeSocketFromRoom(socketId);
  }

  /**
   * Socket.io disconnect (tab close, refresh, network drop). Different from leave_room:
   *  - If this socket belongs to an active player mid-game (`state === 'playing'`),
   *    we KEEP the member in the room and start a 30s reconnect grace window.
   *    The game pauses (no turn auto-pass during grace). If the same uid opens
   *    a new socket before the timer expires → game resumes. Otherwise →
   *    `resetToWaiting` aborts the round and returns survivors to the in-room lobby.
   *  - Otherwise (spectator, or game not in progress), splice immediately.
   */
  handleDisconnect(socketId: string): void {
    const room = this.roomManager.getRoomBySocketId(socketId);
    if (!room) return;

    const member = room.members.find((m) => m.socketId === socketId);
    if (!member) return;

    const isPlayerMidGame =
      room.state === 'playing' && room.playerUids.includes(member.uid);

    if (isPlayerMidGame) {
      this.beginReconnectGrace(room, member.uid);
      return;
    }

    this.removeSocketFromRoom(socketId);
  }

  /**
   * Attempt to reattach an incoming socket to a room that the uid is already in.
   * Called from gateway handleConnection. Returns the room code if a reattach
   * happened, otherwise null.
   *
   * Two reattach paths:
   *  - A pending reconnect grace window exists for this uid → cancel the timer,
   *    clear the `disconnected` flag, broadcast `player_reconnected`, and
   *    deliver a full-state snapshot to the new socket.
   *  - The uid is already a member of a room but has no active socket (e.g.
   *    second tab) → just update socketId so future messages reach them.
   */
  reattachSocketToRoom(uid: string, newSocketId: string): string | null {
    const room = this.roomManager.getRoomByUid(uid);
    if (!room) return null;

    const member = room.members.find((m) => m.uid === uid);
    if (!member) return null;

    // Swap to the new socket either way.
    member.socketId = newSocketId;

    if (room.reconnect && room.reconnect.uid === uid) {
      clearTimeout(room.reconnect.timer);
      room.reconnect = null;
      member.disconnected = false;

      // Resume the turn timer if we paused it and we're in gameplay.
      if (room.state === 'playing' && room.landlordIndex !== -1) {
        this.startTurnTimer(room, room.currentTurn);
      }

      this.emitToRoom(room, 'player_reconnected', {
        uid,
        nickname: member.nickname,
        playerIds: room.playerUids,
      });
      this.emitMembersUpdate(room);
      this.emitFullStateToSocket(newSocketId, room.code);
      this.broadcastRoomList();
      return room.code;
    }

    // No grace window — just send a fresh snapshot so the client renders correctly.
    this.emitFullStateToSocket(newSocketId, room.code);
    return room.code;
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  /**
   * Mark a player as disconnected (without removing them) and start a 30s grace
   * window. The game is effectively paused — the turn timer keeps running on
   * its existing deadline, but a `player_disconnected` overlay covers the board
   * client-side. If the timer fires, the round is aborted.
   */
  private beginReconnectGrace(room: Room, uid: string): void {
    const member = room.members.find((m) => m.uid === uid);
    if (!member) return;

    // If another grace is already running (different uid) — let the first one
    // win: abort immediately so we don't accumulate dangling timers.
    if (room.reconnect && room.reconnect.uid !== uid) {
      clearTimeout(room.reconnect.timer);
      room.reconnect = null;
    }

    // Same uid disconnecting again before the previous timer fired — reset clock.
    if (room.reconnect && room.reconnect.uid === uid) {
      clearTimeout(room.reconnect.timer);
    }

    member.disconnected = true;
    member.socketId = ''; // detach — next reconnect will rebind

    // Pause turn timer during grace so we don't auto-pass on a disconnected player.
    this.clearTurnTimer(room);
    room.turnEndTime = 0;

    const endTime = Date.now() + RECONNECT_GRACE_MS;
    const timer = setTimeout(() => {
      // Grace expired — confirm the room and uid are still in the same state.
      if (room.reconnect?.uid !== uid) return;
      room.reconnect = null;
      // Splice the still-disconnected member, then abort the round.
      const idx = room.members.findIndex((m) => m.uid === uid);
      if (idx !== -1) room.members.splice(idx, 1);
      if (room.members.length === 0) {
        this.roomManager.deleteRoom(room.code);
        this.broadcastRoomList();
        return;
      }
      this.resetToWaiting(room);
      this.broadcastRoomList();
    }, RECONNECT_GRACE_MS);

    room.reconnect = { uid, endTime, timer };

    this.emitToRoom(room, 'player_disconnected', {
      uid,
      nickname: member.nickname,
      endTime,
      timeoutMs: RECONNECT_GRACE_MS,
    });
    this.emitMembersUpdate(room);
    this.broadcastRoomList();
  }

  /**
   * Remove a socket immediately. If the member was an active player mid-game,
   * abort the round and reset to waiting. If the room becomes empty, delete it.
   */
  private removeSocketFromRoom(socketId: string): void {
    const room = this.roomManager.getRoomBySocketId(socketId);
    if (!room) return;

    const removed = this.roomManager.removeSocket(socketId);
    if (!removed) return;

    const { member, wasPlayer } = removed;

    // If a pending reconnect grace was for this uid, clear it — they're leaving for real.
    if (room.reconnect?.uid === member.uid) {
      clearTimeout(room.reconnect.timer);
      room.reconnect = null;
    }

    // If the room is now empty, kill it immediately.
    if (room.members.length === 0) {
      this.roomManager.deleteRoom(room.code);
      this.broadcastRoomList();
      return;
    }

    // If a player left mid-game, abort the round (other members remain as spectators).
    if (wasPlayer && room.state === 'playing') {
      this.resetToWaiting(room);
    } else {
      this.emitMembersUpdate(room);
    }
    this.broadcastRoomList();
  }

  /**
   * Lock in the 3 voters, assign roles, emit `vote_closed_start`, then start
   * a 3-second countdown before kicking off the first bidding round.
   */
  private startGame(room: Room): void {
    // Idempotency guard: only the `waiting → starting` transition may proceed.
    // A duplicate/late entry (re-triggered vote, race) finds a non-waiting state
    // and bails, so the player set and dealing countdown are locked exactly once.
    if (room.state !== 'waiting') return;
    room.state = 'starting';

    const voters = room.members.filter((m) => m.wantToPlay).slice(0, 3);
    room.playerUids = voters.map((m) => m.uid);

    const playerUidSet = new Set(room.playerUids);
    for (const m of room.members) {
      m.role = playerUidSet.has(m.uid) ? 'player' : 'spectator';
    }

    const players = voters.map((m) => ({ id: m.uid, nickname: m.nickname }));
    const spectators = room.members
      .filter((m) => m.role === 'spectator')
      .map((m) => ({ id: m.uid, nickname: m.nickname }));

    this.emitToRoom(room, 'vote_closed_start', { players, spectators, phase: 'dealing' });
    this.emitMembersUpdate(room);
    this.broadcastRoomList();

    setTimeout(() => this.startBiddingRound(room), 3_000);
  }

  private startBiddingRound(room: Room): void {
    // The dealing countdown scheduled this. If anything aborted the start in the
    // meantime (a player left → resetToWaiting, room deleted, etc.) the state is
    // no longer `starting`, so we must not deal a deck into a stale room.
    if (room.state !== 'starting') return;
    // Defensive: a valid round needs exactly 3 connected players. If the set
    // shrank during the countdown, abort back to the lobby instead of dealing
    // a corrupt hand layout.
    const playerMembers = room.playerUids.map((uid) =>
      room.members.find((m) => m.uid === uid),
    );
    if (room.playerUids.length !== 3 || playerMembers.some((m) => !m)) {
      this.resetToWaiting(room);
      return;
    }

    room.state = 'playing';

    room.currentBid = 0;
    room.currentBidder = -1;
    room.bidPassCount = 0;
    room.bidYesVoters = [];
    room.bidVotedIndices = [];
    room.roleDeck = [];
    room.rolePicks = [null, null, null];
    room.roleDrawActive = false;
    room.roleDrawLocked = false;
    room.landlordIndex = -1;
    room.landlordCards = [];
    room.lastPlay = null;
    room.lastPlayedBy = -1;
    room.passCount = 0;
    room.surrendered = [];
    if (room.bidTimer) { clearTimeout(room.bidTimer); room.bidTimer = null; }

    const deck = shuffle(createDeck());
    room.deck = deck;
    room.landlordCards = deck.slice(51, 54);

    for (let i = 0; i < 3; i++) {
      const m = room.members.find((mem) => mem.uid === room.playerUids[i]);
      if (m) m.hand = deck.slice(i * 17, i * 17 + 17);
    }

    for (const m of room.members) {
      if (m.role === 'spectator') m.hand = [];
    }

    room.firstBidder = Math.floor(Math.random() * 3);
    room.currentTurn = room.firstBidder;

    for (let i = 0; i < 3; i++) {
      const m = room.members.find((mem) => mem.uid === room.playerUids[i]);
      if (m) m.hand = sortHand(m.hand);
    }

    for (let i = 0; i < 3; i++) {
      const m = room.members.find((mem) => mem.uid === room.playerUids[i]);
      if (m) {
        this.emitToSocket(m.socketId, 'game_start', { hand: m.hand, firstBidder: room.firstBidder, phase: 'dealing' });
      }
    }

    for (const m of room.members) {
      if (m.role === 'spectator') {
        this.emitToSocket(m.socketId, 'game_start', { hand: [], firstBidder: room.firstBidder, phase: 'dealing' });
      }
    }

    setTimeout(() => {
      this.emitToRoom(room, 'bid_open', { timeoutMs: 8_000, phase: 'bidding' });
      for (let i = 0; i < 3; i++) {
        const uid = room.playerUids[i];
        const m = room.members.find((mem) => mem.uid === uid);
        if (m) {
          this.emitToSocket(m.socketId, 'bid_status', { submitted: room.bidVotedIndices.includes(i) });
        }
      }
      room.bidTimer = setTimeout(() => {
        room.bidTimer = null;
        this.finalizeBidding(room);
      }, 8_000);
    }, 2_000);
  }

  private determineLandlord(room: Room): void {
    const landlordIndex = room.currentBidder;
    room.landlordIndex = landlordIndex;
    // The role draw (if any) is fully over once the game is dealt.
    room.roleDrawActive = false;
    room.roleDrawLocked = false;

    const landlordMember = room.members.find(
      (m) => m.uid === room.playerUids[landlordIndex],
    );
    if (landlordMember) {
      landlordMember.hand.push(...room.landlordCards);
      landlordMember.hand = sortHand(landlordMember.hand);
    }

    room.currentTurn = landlordIndex;
    room.passCount = 0;
    room.lastPlay = null;
    room.lastPlayedBy = landlordIndex;
    room.playHistory = [];

    const playerCardCounts = room.playerUids.map((uid) => {
      const m = room.members.find((mem) => mem.uid === uid);
      return m ? m.hand.length : 0;
    });
    this.emitToRoom(room, 'landlord_decided', {
      playerIndex: landlordIndex,
      landlordCards: room.landlordCards,
      playerCardCounts,
      phase: 'gameplay',
    });

    this.startTurnTimer(room, landlordIndex);
    this.emitGameState(room);
  }

  private finalizeBidding(room: Room): void {
    // Idempotency guard: the landlord is only ever chosen once per round.
    // This can be reached from the 3rd bid AND from the 8s bid-timer callback;
    // if both race, the second entry must not re-push the landlord cards
    // (which would inflate the landlord's hand to 23+). Once landlordIndex is
    // set, the round has moved on — bail.
    if (room.state !== 'playing' || room.landlordIndex !== -1) return;
    if (room.bidTimer) { clearTimeout(room.bidTimer); room.bidTimer = null; }
    // Nobody volunteered → fall back to the 抽地主 (role-card draw) instead of
    // picking a landlord at random.
    if (room.bidYesVoters.length === 0) {
      this.startRoleDraw(room);
      return;
    }
    const chosen = room.bidYesVoters[Math.floor(Math.random() * room.bidYesVoters.length)];
    room.currentBidder = chosen;
    this.determineLandlord(room);
  }

  // ── 抽地主 (role-card draw) ──────────────────────────────────────────────────

  /**
   * Open a 抽地主 draw: three face-down cards (one 地主 + two 農民) are shuffled.
   * Each seated player taps one card to claim it; the slot flips face-up for
   * everyone. There is no countdown — the round resolves once all 3 slots are
   * taken, and whoever drew 地主 becomes the landlord. Any seated player who is
   * disconnected is auto-assigned a random free slot so a dropped socket can
   * never stall the draw.
   */
  private startRoleDraw(room: Room): void {
    if (room.state !== 'playing' || room.landlordIndex !== -1) return;

    room.roleDeck = this.shuffleRoles();
    room.rolePicks = [null, null, null];
    room.roleDrawActive = true;
    room.roleDrawLocked = false;

    this.emitToRoom(room, 'role_draw_open', { phase: 'roledraw' });

    for (let i = 0; i < 3; i++) {
      const m = room.members.find((mem) => mem.uid === room.playerUids[i]);
      if (m && (m.disconnected || !m.socketId)) {
        // Auto-pick a free slot on behalf of a disconnected player.
        const free = room.rolePicks.findIndex((p) => p === null);
        if (free !== -1) this.recordRolePick(room, i, free);
      }
    }
  }

  private shuffleRoles(): ('landlord' | 'peasant')[] {
    const roles: ('landlord' | 'peasant')[] = ['landlord', 'peasant', 'peasant'];
    for (let i = roles.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [roles[i], roles[j]] = [roles[j], roles[i]];
    }
    return roles;
  }

  handleRolePick(socketId: string, slotIndex: number): void {
    const room = this.roomManager.getRoomBySocketId(socketId);
    if (!room || room.state !== 'playing' || room.landlordIndex !== -1) {
      this.server?.to(socketId).emit('room_error', { message: '現在不是抽地主階段' });
      return;
    }
    // The draw is locked once the result is known. Late taps (flipping the
    // leftover card "for fun") are silently ignored, not errored.
    if (!room.roleDrawActive || room.roleDrawLocked) return;
    const member = room.members.find((m) => m.socketId === socketId);
    if (!member) return;
    const playerIndex = room.playerUids.indexOf(member.uid);
    if (playerIndex === -1) return; // spectator

    this.recordRolePick(room, playerIndex, slotIndex);
  }

  private recordRolePick(room: Room, playerIndex: number, slotIndex: number): void {
    if (slotIndex < 0 || slotIndex > 2) return;
    // The slot must be free, and a player may only claim one card.
    if (room.rolePicks[slotIndex] !== null) return;
    if (room.rolePicks.includes(playerIndex)) return;

    room.rolePicks[slotIndex] = playerIndex;
    const role = room.roleDeck[slotIndex];

    // Reveal the flipped card (and who took it) to everyone immediately.
    this.emitToRoom(room, 'role_picked', {
      slotIndex,
      playerIndex,
      role,
      pickedCount: room.rolePicks.filter((p) => p !== null).length,
    });

    // Resolve as soon as the outcome is known:
    //  • the 地主 card is drawn → that player is the landlord, even on the very
    //    first pick (the other two are both 農民 anyway), or
    //  • both 農民 are drawn → the leftover 地主 belongs to the last player by
    //    elimination (i.e. 2 cards down).
    // The remaining card(s) stay flippable for fun on the client only.
    const pickedCount = room.rolePicks.filter((p) => p !== null).length;
    if (role === 'landlord' || pickedCount >= 2) {
      this.resolveRoleDraw(room);
    }
  }

  private resolveRoleDraw(room: Room): void {
    if (room.state !== 'playing' || room.landlordIndex !== -1 || room.roleDrawLocked) return;

    // Lock the draw so no further picks count. Players may still flip the
    // leftover card for fun, but it no longer changes anything. The draw stays
    // "active" (screen shown) until the game is actually dealt.
    room.roleDrawLocked = true;

    const landlordSlot = room.roleDeck.findIndex((r) => r === 'landlord');
    // The landlord is whoever took the 地主 slot; if it's the still-unpicked
    // leftover, it belongs to the one player who hasn't drawn yet.
    let chosen = room.rolePicks[landlordSlot];
    if (chosen === null) {
      chosen = [0, 1, 2].find((pi) => !room.rolePicks.includes(pi)) ?? null;
    }
    if (chosen === null) return; // defensive
    room.currentBidder = chosen;

    // Tell the room the result is locked and the game starts shortly. The full
    // deck is included so the leftover face-down card can still be revealed
    // (for fun) on the client. No countdown is shown — clients just wait for
    // the subsequent landlord_decided event.
    this.emitToRoom(room, 'role_draw_locked', {
      landlordIndex: chosen,
      roleDeck: room.roleDeck,
    });

    // Brief pause on the revealed cards before dealing starts.
    setTimeout(() => {
      if (room.state !== 'playing' || room.landlordIndex !== -1) return;
      this.determineLandlord(room);
    }, 3_000);
  }

  private startTurnTimer(room: Room, playerIndex: number): void {
    if (room.turnTimer) clearTimeout(room.turnTimer);
    room.turnEndTime = Date.now() + TURN_TIMEOUT_MS;
    room.turnTimer = setTimeout(() => {
      room.turnTimer = null;
      const uid = room.playerUids[playerIndex];
      const m = room.members.find((mem) => mem.uid === uid);
      if (m) this.handlePass(m.socketId);
    }, TURN_TIMEOUT_MS);
  }

  private clearTurnTimer(room: Room): void {
    if (room.turnTimer) { clearTimeout(room.turnTimer); room.turnTimer = null; }
  }

  private handleWin(
    room: Room,
    winner: 'landlord' | 'peasants',
    reason: 'normal' | 'surrender' = 'normal',
  ): void {
    const winningCards = room.lastPlay ? room.lastPlay.cards : [];

    // Update per-room win tally (keyed by uid)
    const playerMembers = room.playerUids
      .map((uid) => room.members.find((m) => m.uid === uid))
      .filter(Boolean) as Member[];

    for (let i = 0; i < playerMembers.length; i++) {
      const isWinner =
        winner === 'landlord' ? i === room.landlordIndex : i !== room.landlordIndex;
      if (isWinner) {
        const uid = playerMembers[i].uid;
        room.winCounts[uid] = (room.winCounts[uid] ?? 0) + 1;
      }
    }

    // Persist to leaderboard DB (fire-and-forget; service logs errors internally).
    if (playerMembers.length === 3) {
      const dbWinnerRole: 'landlord' | 'farmer' = winner === 'landlord' ? 'landlord' : 'farmer';
      const storedPlays = room.playHistory.map((h) => ({
        seat: h.playerIndex,
        cards: h.play.cards,
      }));
      void this.leaderboardService.recordResult(
        dbWinnerRole,
        playerMembers.map((m, seat) => {
          const role: 'landlord' | 'farmer' = seat === room.landlordIndex ? 'landlord' : 'farmer';
          const won = winner === 'landlord' ? seat === room.landlordIndex : seat !== room.landlordIndex;
          return { uid: m.uid, role, won, seat };
        }),
        storedPlays,
      );
    }

    // Authoritative winners list (uids)
    const winnerIds = room.playerUids.filter((_, i) =>
      winner === 'landlord' ? i === room.landlordIndex : i !== room.landlordIndex,
    );

    room.resultPending = true;

    this.emitToRoom(room, 'game_over', {
      winner,
      winReason: reason,
      landlordIndex: room.landlordIndex,
      winCounts: room.winCounts,
      winnerIds,
      winningCards,
      phase: 'result',
    });

    // Tear down game state
    for (const m of room.members) {
      m.role = 'spectator';
      m.hand = [];
      m.wantToPlay = false;
      m.disconnected = false;
    }
    if (room.reconnect) { clearTimeout(room.reconnect.timer); room.reconnect = null; }

    room.deck = [];
    room.landlordCards = [];
    room.landlordIndex = -1;
    room.passCount = 0;
    room.lastPlay = null;
    room.lastPlayedBy = -1;
    room.playHistory = [];
    room.turnEndTime = 0;
    room.bidPassCount = 0;
    room.bidVotedIndices = [];
    room.surrendered = [];
    if (room.bidTimer) { clearTimeout(room.bidTimer); room.bidTimer = null; }
    this.clearTurnTimer(room);
    room.playerUids = [];

    room.state = 'waiting';

    // Eight seconds, not five: a 天堂製造 finish spends 2.4s on its cold open
    // and 3.6s on its banner before the result screen is allowed to appear.
    setTimeout(() => {
      room.resultPending = false;
      this.emitToRoom(room, 'return_to_lobby', { phase: 'lobby' });
      this.emitMembersUpdate(room);
      this.broadcastRoomList();
    }, 8_000);
  }

  /**
   * Abort a live game (e.g. player disconnected mid-game).
   * Remaining members revert to spectator with cleared flags.
   */
  private resetToWaiting(room: Room): void {
    if (room.bidTimer) { clearTimeout(room.bidTimer); room.bidTimer = null; }
    if (room.reconnect) { clearTimeout(room.reconnect.timer); room.reconnect = null; }
    this.clearTurnTimer(room);

    for (const m of room.members) {
      m.role = 'spectator';
      m.hand = [];
      m.wantToPlay = false;
      m.disconnected = false;
    }

    room.state = 'waiting';
    room.playerUids = [];
    room.deck = [];
    room.landlordCards = [];
    room.landlordIndex = -1;
    room.currentTurn = 0;
    room.currentBid = 0;
    room.currentBidder = -1;
    room.passCount = 0;
    room.lastPlay = null;
    room.lastPlayedBy = -1;
    room.playHistory = [];
    room.turnEndTime = 0;
    room.bidPassCount = 0;
    room.bidYesVoters = [];
    room.bidVotedIndices = [];
    room.surrendered = [];

    this.emitToRoom(room, 'game_aborted', { phase: 'lobby' });
    this.emitMembersUpdate(room);
    this.broadcastRoomList();
  }

  // ── Emoji reactions ──────────────────────────────────────────────────────────

  handleReactEmoji(socketId: string, emoji: string): void {
    const room = this.roomManager.getRoomBySocketId(socketId);
    if (!room) return;
    const member = room.members.find((m) => m.socketId === socketId);
    if (!member) return;

    this.emitToRoom(room, 'emoji_reaction', {
      senderId: member.uid,
      senderUid: member.uid,
      senderNickname: member.nickname,
      role: member.role,
      emoji,
    });
  }

  // ── Sync request (full-state snapshot for a single socket) ──────────────────

  /**
   * Re-emit the full room state to a single socket.
   * Used by the frontend after detecting a seq gap.
   */
  emitFullStateToSocket(socketId: string, roomCode: string): void {
    const room = this.roomManager.getRoom(roomCode);
    if (!room) return;
    const member = room.members.find((m) => m.socketId === socketId);
    if (!member) return;

    const members = this.serializeMembers(room);
    const readyCount = members.filter((m) => m.wantToPlay).length;
    const canVote = room.state === 'waiting';

    const phase = room.state === 'playing'
      ? (room.landlordIndex >= 0
          ? 'gameplay'
          : room.roleDrawActive
            ? 'roledraw'
            : 'bidding')
      : 'lobby';

    this.server?.to(socketId).emit('room_joined', {
      roomCode,
      members,
      state: room.state,
      playerIds: room.playerUids,
      playerUids: room.playerUids,
      myUid: member.uid,
      seq: room.eventSeq,
      winCounts: room.winCounts,
      phase,
      readyCount,
      canVote,
    });

    if (room.state === 'playing' && member.role === 'player') {
      this.emitToSocket(member.socketId, 'game_start', {
        hand: member.hand,
        firstBidder: room.firstBidder,
        reconnect: true,
      });
      const pi = room.playerUids.indexOf(member.uid);
      if (room.landlordIndex === -1 && room.roleDrawActive) {
        // Replay the current draw: which slots are revealed (and as what), plus
        // whether this player has already claimed a card.
        const revealed = room.rolePicks.map((p, slot) =>
          p === null
            ? null
            : { slotIndex: slot, playerIndex: p, role: room.roleDeck[slot] },
        );
        this.emitToSocket(member.socketId, 'role_draw_open', {
          phase: 'roledraw',
          revealed,
          submitted: room.rolePicks.includes(pi),
        });
        // If the result is already locked (3s start delay running), replay the
        // lock so the reconnecting client shows "starting" and the full deck.
        if (room.roleDrawLocked) {
          this.emitToSocket(member.socketId, 'role_draw_locked', {
            landlordIndex: room.currentBidder,
            roleDeck: room.roleDeck,
          });
        }
      } else if (room.landlordIndex === -1) {
        this.emitToSocket(member.socketId, 'bid_turn', {
          playerIndex: room.currentTurn,
          currentBid: room.currentBid,
          submitted: room.bidVotedIndices.includes(pi),
        });
      } else {
        this.emitGameStateToSocket(room, member.socketId);
      }
    } else if (room.state === 'playing' && room.landlordIndex >= 0) {
      this.emitGameStateToSocket(room, member.socketId);
    }
  }

  // ── External hooks (called from other modules) ──────────────────────────────

  /**
   * Update the in-memory nickname/avatar of the given uid if they are currently
   * in a room, and broadcast members_update + room list refresh so other
   * connected clients see the change immediately.
   *
   * Called by UsersService after a profile edit.
   */
  refreshUserInRoom(
    uid: string,
    patch: { nickname?: string; avatarUrl?: string | null },
  ): void {
    // Update socket.data.user on every connected socket for this uid so that
    // their next create_room/join_room sees the fresh values.
    if (this.server) {
      for (const socket of this.server.sockets.sockets.values()) {
        const u = (socket as unknown as { data: { user?: AuthedUser } }).data.user;
        if (u?.uid !== uid) continue;
        if (patch.nickname !== undefined) u.nickname = patch.nickname;
        if (patch.avatarUrl !== undefined) u.avatarUrl = patch.avatarUrl;
      }
    }

    // Update the in-room Member snapshot and broadcast.
    const room = this.roomManager.getRoomByUid(uid);
    if (!room) return;

    const member = room.members.find((m) => m.uid === uid);
    if (!member) return;

    let changed = false;
    if (patch.nickname !== undefined && patch.nickname !== member.nickname) {
      member.nickname = patch.nickname;
      changed = true;
    }
    if (patch.avatarUrl !== undefined && patch.avatarUrl !== member.avatarUrl) {
      member.avatarUrl = patch.avatarUrl;
      changed = true;
    }
    if (!changed) return;

    this.emitMembersUpdate(room);
    this.broadcastRoomList();
  }

  // ── Lobby room list ─────────────────────────────────────────────────────────

  /**
   * Build the room-list payload for the lobby. Each card includes member
   * avatars, current game state, and (if uid is provided) a `myMembership`
   * flag indicating whether the requesting user is already a member.
   */
  buildRoomList(uid: string | null) {
    return this.roomManager.allRooms().map((room) => {
      const phase: 'waiting' | 'bidding' | 'playing' =
        room.state === 'waiting'
          ? 'waiting'
          : room.landlordIndex === -1
            ? 'bidding'
            : 'playing';

      const currentTurnUid = room.playerUids[room.currentTurn] ?? null;
      const playerUidSet = new Set(room.playerUids);

      const members = room.members.map((m) => ({
        uid: m.uid,
        nickname: m.nickname,
        avatarUrl: m.avatarUrl,
        role: m.role,
        isCurrentTurn: phase === 'playing' && m.uid === currentTurnUid,
        isPlayer: playerUidSet.has(m.uid),
      }));

      const myMembership: 'none' | 'player' | 'spectator' = !uid
        ? 'none'
        : playerUidSet.has(uid)
          ? 'player'
          : room.members.some((m) => m.uid === uid)
            ? 'spectator'
            : 'none';

      return {
        code: room.code,
        phase,
        members,
        memberCount: room.members.length,
        playerCount: room.members.filter((m) => playerUidSet.has(m.uid)).length,
        spectatorCount: room.members.filter((m) => !playerUidSet.has(m.uid))
          .length,
        myMembership,
      };
    });
  }

  /**
   * Broadcast the room list to every socket in the lobby room.
   * Each socket receives a per-uid version so `myMembership` is accurate.
   */
  broadcastRoomList(): void {
    if (!this.server) return;
    const sockets = this.server.sockets.adapter.rooms.get(LOBBY_ROOM);
    if (!sockets) return;
    for (const socketId of sockets) {
      const socket = this.server.sockets.sockets.get(socketId);
      if (!socket) continue;
      const uid = (socket as unknown as { data: { user?: { uid: string } } })
        .data.user?.uid ?? null;
      socket.emit('rooms_updated', { rooms: this.buildRoomList(uid) });
    }
  }

  /** Send the room list to a single socket (used on join_lobby request). */
  emitRoomListToSocket(socketId: string, uid: string | null): void {
    this.server?.to(socketId).emit('rooms_updated', {
      rooms: this.buildRoomList(uid),
    });
  }

  // ── Stats (used by HealthController) ────────────────────────────────────────

  get roomCount(): number {
    return this.roomManager.roomCount;
  }
}
