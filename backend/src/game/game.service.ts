import { Injectable } from '@nestjs/common';
import { Server } from 'socket.io';
import { createDeck, shuffle, sortHand, validatePlay } from './card.utils';
import { RoomManager } from './room.manager';
import { Card, Member, Room } from './types';
import type { AuthedUser } from '../auth/auth.service';
import { LeaderboardService } from '../leaderboard/leaderboard.service';

const TURN_TIMEOUT_MS = 30_000;

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
      phase: 'gameplay',
    };
  }

  /** Unicast a game_state snapshot to a single socket. */
  private emitGameStateToSocket(room: Room, socketId: string): void {
    this.server?.to(socketId).emit('game_state', this.buildGameStatePayload(room));
  }

  /** Broadcast game_state to the room, then unicast each player's hand. */
  private emitGameState(room: Room): void {
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

  /** Broadcast the full member list to the room. */
  private emitMembersUpdate(room: Room): void {
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

  /**
   * Builds the room_joined payload for the gateway to unicast to the new socket.
   * Should be called AFTER the gateway has done socket.join(roomCode).
   */
  buildRoomJoinedPayload(uid: string, roomCode: string) {
    const room = this.roomManager.getRoom(roomCode);
    if (!room) return null;

    const members = this.serializeMembers(room);
    const readyCount = members.filter((m) => m.wantToPlay).length;
    const canVote = room.state === 'waiting';

    return {
      roomCode,
      members,
      state: room.state,
      playerIds: room.playerUids, // backward-compat name; values are now uids
      playerUids: room.playerUids,
      myUid: uid,
      seq: room.eventSeq,
      winCounts: room.winCounts,
      readyCount,
      canVote,
    };
  }

  // ── Voting ──────────────────────────────────────────────────────────────────

  /**
   * Toggle a member's intent to play. When exactly 3 members have flagged
   * wantToPlay, the game starts immediately.
   */
  handleVotePlay(socketId: string): void {
    const room = this.roomManager.getRoomBySocketId(socketId);
    if (!room) return;

    if (room.state === 'playing' || room.resultPending) {
      this.server?.to(socketId).emit('room_error', { message: '遊戲進行中，無法投票' });
      return;
    }

    const member = room.members.find((m) => m.socketId === socketId);
    if (!member) return;

    member.wantToPlay = !member.wantToPlay;
    this.emitMembersUpdate(room);

    const voters = room.members.filter((m) => m.wantToPlay);
    if (voters.length >= 3) {
      this.startGame(room);
    }
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

  /** Explicit leave_room from the client. */
  handleLeaveRoom(socketId: string): void {
    this.removeSocketFromRoom(socketId);
  }

  /** Socket.io disconnect (tab close / network drop). Same handling as leave. */
  handleDisconnect(socketId: string): void {
    this.removeSocketFromRoom(socketId);
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  /**
   * Remove a socket immediately. If the member was an active player mid-game,
   * abort the round and reset to waiting. If the room becomes empty, delete it.
   */
  private removeSocketFromRoom(socketId: string): void {
    const room = this.roomManager.getRoomBySocketId(socketId);
    if (!room) return;

    const removed = this.roomManager.removeSocket(socketId);
    if (!removed) return;

    const { wasPlayer } = removed;

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
    room.state = 'playing';

    room.currentBid = 0;
    room.currentBidder = -1;
    room.bidPassCount = 0;
    room.bidYesVoters = [];
    room.bidVotedIndices = [];
    room.landlordIndex = -1;
    room.landlordCards = [];
    room.lastPlay = null;
    room.lastPlayedBy = -1;
    room.passCount = 0;
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
    if (room.bidTimer) { clearTimeout(room.bidTimer); room.bidTimer = null; }
    let chosen: number;
    if (room.bidYesVoters.length === 0) {
      chosen = Math.floor(Math.random() * 3);
    } else {
      chosen = room.bidYesVoters[Math.floor(Math.random() * room.bidYesVoters.length)];
    }
    room.currentBidder = chosen;
    this.determineLandlord(room);
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

  private handleWin(room: Room, winner: 'landlord' | 'peasants'): void {
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
    }

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
    if (room.bidTimer) { clearTimeout(room.bidTimer); room.bidTimer = null; }
    this.clearTurnTimer(room);
    room.playerUids = [];

    room.state = 'waiting';

    setTimeout(() => {
      room.resultPending = false;
      this.emitToRoom(room, 'return_to_lobby', { phase: 'lobby' });
      this.emitMembersUpdate(room);
      this.broadcastRoomList();
    }, 5_000);
  }

  /**
   * Abort a live game (e.g. player disconnected mid-game).
   * Remaining members revert to spectator with cleared flags.
   */
  private resetToWaiting(room: Room): void {
    if (room.bidTimer) { clearTimeout(room.bidTimer); room.bidTimer = null; }
    this.clearTurnTimer(room);

    for (const m of room.members) {
      m.role = 'spectator';
      m.hand = [];
      m.wantToPlay = false;
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
      ? (room.landlordIndex >= 0 ? 'gameplay' : 'bidding')
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
      if (room.landlordIndex === -1) {
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
