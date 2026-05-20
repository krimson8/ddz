import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Server } from 'socket.io';
import { createDeck, shuffle, sortHand, validatePlay } from './card.utils';
import { RoomManager } from './room.manager';
import { Card, Member, Room } from './types';

const TURN_TIMEOUT_MS = 30_000;

// ── Nickname sanitisation ────────────────────────────────────────────────────

/** Strip HTML tags and control characters; enforce 2–10 character length. */
function sanitizeNickname(raw: string): string | null {
  const cleaned = raw
    .replace(/<[^>]*>/g, '') // strip HTML tags
    .replace(/[\x00-\x1f\x7f]/g, '') // strip control chars
    .trim();
  if (cleaned.length < 2 || cleaned.length > 10) return null;
  return cleaned;
}

// ── Public return types used by the gateway ──────────────────────────────────

export interface JoinResult {
  roomCode: string;
  reconnectToken: string;
  /** Sanitised (possibly suffixed) nickname actually used */
  nickname: string;
}

export interface ReconnectResult {
  roomCode: string;
  wasDisconnected: boolean;
  newReconnectToken: string;
}

// ── GameService ──────────────────────────────────────────────────────────────

/**
 * Central state machine for the Dou Di Zhu game.
 *
 * Event-emission contract with the gateway (Phase 5):
 *  - The gateway must call `socket.join(roomCode)` *before* calling any
 *    handleCreateRoom / handleJoinRoom / handleReconnect method so that future
 *    room-wide broadcasts reach the new socket.
 *  - The gateway calls `setServer(server)` inside `afterInit()`.
 *  - All other handle* methods are called directly from @SubscribeMessage handlers.
 */
@Injectable()
export class GameService {
  private server!: Server;

  constructor(private readonly roomManager: RoomManager) {}

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
   *
   * Called after every state-changing gameplay action: card play, pass,
   * new round, landlord decided, and turn timer expiry.
   */
  private buildGameStatePayload(room: Room): object {
    return {
      currentPlayer: room.playerIds[room.currentTurn] ?? null,
      currentPlayerEndTime: room.turnEndTime,
      onTable: room.lastPlay,
      history: room.playHistory,
      playerCardCounts: room.playerIds.map((id) => {
        const m = room.members.find((mem) => mem.id === id);
        return m ? m.hand.length : 0;
      }),
      landlordIndex: room.landlordIndex,
      landlordCards: room.landlordCards,
      phase: 'gameplay',
    };
  }

  /** Unicast a game_state snapshot to a single socket (reconnect / spectator join). */
  private emitGameStateToSocket(room: Room, socketId: string): void {
    this.server?.to(socketId).emit('game_state', this.buildGameStatePayload(room));
  }

  /** Broadcast game_state to the room, then unicast each player's hand. */
  private emitGameState(room: Room): void {
    this.emitToRoom(room, 'game_state', this.buildGameStatePayload(room));
    for (let i = 0; i < 3; i++) {
      const pid = room.playerIds[i];
      const m = room.members.find((mem) => mem.id === pid);
      if (m) this.emitToSocket(pid, 'hand_updated', { hand: m.hand });
    }
  }

  /** Broadcast the full connected member list to the room. */
  private emitMembersUpdate(room: Room): void {
    const members = room.members
      .filter((m) => !m.disconnectedAt)
      .map((m) => ({
        id: m.id,
        nickname: m.nickname,
        role: m.role,
        cardCount: m.hand.length,
        wantToPlay: m.wantToPlay,
      }));
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
   * Create a new room. Returns info for the gateway to complete the flow:
   *   1. socket.join(roomCode)
   *   2. socket.emit('room_created', { roomCode, reconnectToken })
   */
  handleCreateRoom(
    socketId: string,
    rawNickname: string,
  ): JoinResult | { error: string } {
    const nickname = sanitizeNickname(rawNickname);
    if (!nickname) {
      return { error: '暱稱必須為 2–10 個字元' };
    }

    if (this.roomManager.roomCount >= 500) {
      return { error: '伺服器已達到最大房間數，請稍後再試' };
    }

    const { room, reconnectToken } = this.roomManager.createRoom(
      nickname,
      socketId,
    );

    return { roomCode: room.code, reconnectToken, nickname };
  }

  /**
   * Join an existing room. Returns info for the gateway to complete the flow:
   *   1. socket.join(roomCode)
   *   2. socket.emit('room_joined', { roomCode, reconnectToken, members, state })
   *   3. (already emitted by this method) room broadcast: members_update
   *
   * Safe to call in any RoomState — new members always join as spectators.
   */
  handleJoinRoom(
    socketId: string,
    code: string,
    rawNickname: string,
  ): JoinResult | { error: string } {
    const nickname = sanitizeNickname(rawNickname);
    if (!nickname) {
      return { error: '暱稱必須為 2–10 個字元' };
    }

    const upperCode = code.toUpperCase().trim();
    if (!/^[A-Z2-9]{6}$/.test(upperCode)) {
      return { error: '無效的房間代碼' };
    }

    const room = this.roomManager.getRoom(upperCode);
    if (!room) {
      return { error: '找不到房間' };
    }

    // Cancel idle timer — room is no longer empty
    if (room.idleTimeout) {
      clearTimeout(room.idleTimeout);
      room.idleTimeout = null;
    }

    if (room.members.length >= 10) {
      return { error: '房間人數已滿（最多 10 人）' };
    }

    const result = this.roomManager.joinRoom(upperCode, nickname, socketId);
    if (!result) {
      return { error: '加入房間失敗' };
    }

    const { member, reconnectToken } = result;

    // Broadcast full member list to existing room members (new member hasn't
    // socket.join'd yet, so they won't receive this — correct behaviour)
    this.emitMembersUpdate(room);

    return { roomCode: upperCode, reconnectToken, nickname: member.nickname };
  }

  /**
   * Builds the room_joined payload for the gateway to unicast to the new socket.
   * Should be called AFTER the gateway has done socket.join(roomCode).
   */
  buildRoomJoinedPayload(socketId: string, roomCode: string) {
    const room = this.roomManager.getRoom(roomCode);
    if (!room) return null;

    const members = room.members
      .filter((m) => !m.disconnectedAt)
      .map((m) => ({
        id: m.id,
        nickname: m.nickname,
        role: m.role,
        cardCount: m.hand.length,
        wantToPlay: m.wantToPlay,
      }));

    const readyCount = members.filter((m) => m.wantToPlay).length;
    const canVote = room.state === 'waiting';

    return {
      roomCode,
      members,
      state: room.state,
      playerIds: room.playerIds,
      seq: room.eventSeq,
      winCounts: room.winCounts,
      readyCount,
      canVote,
    };
  }

  // ── Reconnection ────────────────────────────────────────────────────────────

  /**
   * Restore a previously disconnected player's session.
   *
   * Gateway flow:
   *   1. Call handleReconnect → get roomCode
   *   2. socket.join(roomCode)
   *   3. Call emitReconnectState(socketId, roomCode) to push state to the socket
   */
  handleReconnect(
    newSocketId: string,
    token: string,
    code: string,
  ): ReconnectResult | null {
    const upperCode = code.toUpperCase().trim();
    console.log('[handleReconnect] newSocketId:', newSocketId, 'token:', token, 'code:', code, 'upperCode:', upperCode);
    const debugRoom = this.roomManager.getRoom(upperCode);
    console.log('[handleReconnect] room exists:', !!debugRoom, 'members:', debugRoom?.members.map(m => ({ id: m.id, nick: m.nickname, token: m.reconnectToken, disconnectedAt: m.disconnectedAt })));
    const found = this.roomManager.findByReconnectToken(token, upperCode);
    console.log('[handleReconnect] findByReconnectToken result:', found ? { memberId: found.member.id, nick: found.member.nickname, disconnectedAt: found.member.disconnectedAt } : null);
    if (!found) return null;

    const { room, member } = found;

    // Rotate the token on every successful reconnect to prevent replay attacks
    const newReconnectToken = randomUUID();
    member.reconnectToken = newReconnectToken;

    // Still connected (e.g. SPA navigation) — update socket id and return
    if (!member.disconnectedAt) {
      member.id = newSocketId;
      return { roomCode: upperCode, wasDisconnected: false, newReconnectToken };
    }

    // Cancel the pending 60 s reset timer for this player
    const oldSocketId = member.id;
    const timer = room.reconnectTimers.get(oldSocketId);
    if (timer) {
      clearTimeout(timer);
      room.reconnectTimers.delete(oldSocketId);
    }

    // Restore socket identity and keep playerIds in sync
    member.id = newSocketId;
    member.disconnectedAt = undefined;

    const pidIdx = room.playerIds.indexOf(oldSocketId);
    if (pidIdx !== -1) room.playerIds[pidIdx] = newSocketId;

    return { roomCode: upperCode, wasDisconnected: true, newReconnectToken };
  }

  /**
   * Emit the current game state back to a reconnected player.
   * Must be called AFTER the gateway has done socket.join(roomCode).
   */
  emitReconnectState(socketId: string, roomCode: string, wasDisconnected = true, newReconnectToken?: string): void {
    const room = this.roomManager.getRoom(roomCode);
    if (!room) return;

    const member = room.members.find((m) => m.id === socketId);
    if (!member) return;

    // Unicast full room state
    const members = room.members
      .filter((m) => !m.disconnectedAt)
      .map((m) => ({
        id: m.id,
        nickname: m.nickname,
        role: m.role,
        cardCount: m.hand.length,
        wantToPlay: m.wantToPlay,
      }));

    const reconnectPhase = room.state === 'playing'
      ? (room.landlordIndex >= 0 ? 'gameplay' : 'bidding')
      : 'lobby';

    this.server?.to(socketId).emit('room_joined', {
      roomCode,
      members,
      state: room.state,
      playerIds: room.playerIds,
      seq: room.eventSeq,
      reconnect: true,
      winCounts: room.winCounts,
      phase: reconnectPhase,
      ...(newReconnectToken ? { reconnectToken: newReconnectToken } : {}),
    });

    // Re-send game state if room is in playing state
    if (room.state === 'playing') {
      if (member.role === 'player') {
        this.server?.to(socketId).emit('game_start', {
          hand: member.hand,
          firstBidder: room.firstBidder,
          reconnect: true,
        });

        const playerIndex = room.playerIds.indexOf(socketId);
        if (playerIndex !== -1) {
          if (room.landlordIndex === -1) {
            // During bidding: re-send bid panel state
            this.server?.to(socketId).emit('bid_turn', {
              playerIndex: room.currentTurn,
              currentBid: room.currentBid,
              submitted: room.bidVotedIndices.includes(playerIndex),
            });
          } else {
            this.emitGameStateToSocket(room, socketId);
          }
        }
      } else if (room.landlordIndex >= 0) {
        // Spectator joining mid-gameplay: send full board snapshot
        this.emitGameStateToSocket(room, socketId);
      }
    }

    // Let room know the member list has changed (skip for soft reconnects like SPA nav)
    if (wasDisconnected) {
      // Include playerIds so other clients can update their playerOrder with the
      // reconnected player's new socket ID.
      this.emitToRoom(room, 'player_reconnected', {
        nickname: member.nickname,
        playerIds: room.playerIds,
      });
      this.emitMembersUpdate(room);
    }
  }

  // ── Voting ──────────────────────────────────────────────────────────────────

  /**
   * Toggle a member's intent to play. When exactly 3 members have flagged
   * wantToPlay, the game starts immediately and the flags are locked.
   * Available in any state except 'playing'.
   */
  handleVotePlay(socketId: string): void {
    const room = this.roomManager.getRoomBySocketId(socketId);
    if (!room) return;

    if (room.state === 'playing') {
      this.server?.to(socketId).emit('room_error', { message: '遊戲進行中，無法投票' });
      return;
    }

    const member = room.members.find((m) => m.id === socketId);
    if (!member) return;

    // Toggle
    member.wantToPlay = !member.wantToPlay;

    // Broadcast updated list so all clients re-render
    this.emitMembersUpdate(room);

    // Count how many want to play
    const voters = room.members.filter((m) => m.wantToPlay && !m.disconnectedAt);
    if (voters.length >= 3) {
      this.startGame(room);
    }
  }

  // ── Bidding ─────────────────────────────────────────────────────────────────

  /**
   * Process a yes (value 1) or no (value 0) landlord vote from a player.
   * All 3 players vote simultaneously; the 15-second window is enforced
   * server-side by a timer set in startBiddingRound.
   * If all 3 vote early the timer is cancelled and the landlord is resolved immediately.
   */
  handleBid(socketId: string, value: 0 | 1): void {
    const room = this.roomManager.getRoomBySocketId(socketId);
    if (!room || room.state !== 'playing' || room.landlordIndex !== -1) {
      this.server
        ?.to(socketId)
        .emit('room_error', { message: '現在不是叫地主階段' });
      return;
    }

    const playerIndex = room.playerIds.indexOf(socketId);
    if (playerIndex === -1) return; // spectator

    // Prevent duplicate votes
    if (room.bidVotedIndices.includes(playerIndex)) return;
    room.bidVotedIndices.push(playerIndex);

    if (value === 1) {
      room.bidYesVoters.push(playerIndex);
    }
    room.bidPassCount++;

    this.emitToRoom(room, 'bid_made', { playerIndex, value, votedCount: room.bidPassCount });

    // If all 3 have voted early, finalize now
    if (room.bidPassCount >= 3) {
      this.finalizeBidding(room);
    }
  }

  // ── Gameplay ─────────────────────────────────────────────────────────────────

  /**
   * Play a set of cards on the current player's turn.
   * Validates ownership, hand type, and that it beats the last play.
   */
  handlePlayCards(socketId: string, cards: Card[]): void {
    const room = this.roomManager.getRoomBySocketId(socketId);
    if (!room || room.state !== 'playing' || room.landlordIndex === -1) {
      this.server
        ?.to(socketId)
        .emit('room_error', { message: '現在不是出牌階段' });
      return;
    }

    const playerIndex = room.playerIds.indexOf(socketId);
    if (playerIndex === -1) return; // spectator

    if (playerIndex !== room.currentTurn) {
      this.server?.to(socketId).emit('room_error', { message: '還不是你的回合' });
      return;
    }

    const member = room.members.find((m) => m.id === socketId)!;

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

    // Commit: update hand and room state
    member.hand = handCopy;
    room.lastPlay = result;
    room.lastPlayedBy = playerIndex;
    room.passCount = 0;
    room.playHistory.push({ playerIndex, play: result });

    // Win check before advancing turn
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
   * Pass the current player's turn.
   * Two consecutive passes trigger a new lead round.
   */
  handlePass(socketId: string): void {
    const room = this.roomManager.getRoomBySocketId(socketId);
    if (!room || room.state !== 'playing' || room.landlordIndex === -1) {
      return;
    }

    const playerIndex = room.playerIds.indexOf(socketId);
    if (playerIndex === -1 || playerIndex !== room.currentTurn) return;

    room.passCount++;

    if (room.passCount >= 2) {
      // Two consecutive passes → the player who last played leads a new round
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
   * Handle an explicit "leave room" request from the client.
   * Unlike a connection drop, there is no reconnect grace window —
   * the player is removed immediately.
   */
  handleLeaveRoom(socketId: string): void {
    this.removeSocketFromRoom(socketId, /* grantReconnect */ false);
  }

  /**
   * Handle a socket.io disconnect event (connection drop / tab close).
   * Players during a live game receive a 60-second reconnect window;
   * all others are removed immediately.
   */
  handleDisconnect(socketId: string): void {
    this.removeSocketFromRoom(socketId, /* grantReconnect */ true);
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  /**
   * Core disconnect logic. `grantReconnect` controls whether a player that
   * disconnects mid-game stays in the room list for a 60-second window.
   */
  private removeSocketFromRoom(
    socketId: string,
    grantReconnect: boolean,
  ): void {
    const room = this.roomManager.getRoomBySocketId(socketId);
    if (!room) return;

    const member = room.members.find((m) => m.id === socketId);
    if (!member) return;

    const wasPlayer = member.role === 'player';

    if (grantReconnect && wasPlayer && room.state === 'playing') {
      // --- Reconnect window path ---
      // Keep the member in the room but mark them as disconnected.
      member.disconnectedAt = Date.now();

      // Broadcast updated member list (disconnected member filtered out)
      this.emitMembersUpdate(room);

      this.emitToRoom(room, 'player_disconnected', {
        nickname: member.nickname,
        timeoutMs: 15_000,
      });

      // Schedule automatic room reset if player doesn't reconnect in time
      const timer = setTimeout(() => {
        room.reconnectTimers.delete(socketId);
        this.resetToWaiting(room);
      }, 15_000);
      room.reconnectTimers.set(socketId, timer);
    } else {
      // --- Immediate remove path ---
      this.roomManager.removeSocket(socketId);

      this.emitMembersUpdate(room);

      // If this was the last member, start the idle-cleanup timer
      if (room.members.length === 0) {
        this.startIdleTimeout(room);
      }

      // If the room had a player leave during playing state (without reconnect),
      // treat it the same as a timeout: reset to waiting.
      if (wasPlayer && room.state === 'playing') {
        this.resetToWaiting(room);
      }
    }
  }

  /**
   * Lock in the 3 voters, assign roles, emit `vote_closed_start`, then start
   * a 3-second countdown before kicking off the first bidding round.
   */
  private startGame(room: Room): void {
    // Pick exactly the first 3 members who want to play (connected only)
    const voters = room.members.filter((m) => m.wantToPlay && !m.disconnectedAt).slice(0, 3);
    room.playerIds = voters.map((m) => m.id);

    // Assign roles
    const playerIdSet = new Set(room.playerIds);
    for (const m of room.members) {
      m.role = playerIdSet.has(m.id) ? 'player' : 'spectator';
    }

    const players = voters.map((m) => ({ id: m.id, nickname: m.nickname }));
    const spectators = room.members
      .filter((m) => m.role === 'spectator')
      .map((m) => ({ id: m.id, nickname: m.nickname }));

    this.emitToRoom(room, 'vote_closed_start', { players, spectators, phase: 'dealing' });

    // Broadcast updated roles so all clients see the locked-in player list
    // without having to derive roles from vote_closed_start on the frontend.
    this.emitMembersUpdate(room);

    // 3-second countdown, then deal
    setTimeout(() => this.startBiddingRound(room), 3_000);
  }

  /**
   * Shuffle and deal a fresh hand; choose a random first bidder.
   * Emits `game_start` (privately to each player) and the first `bid_turn`.
   */
  private startBiddingRound(room: Room): void {
    room.state = 'playing';

    // Reset bidding fields
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

    // Shuffle and deal 17 cards to each player; reserve last 3 as landlord cards
    const deck = shuffle(createDeck());
    room.deck = deck;
    room.landlordCards = deck.slice(51, 54); // last 3 cards

    for (let i = 0; i < 3; i++) {
      const m = room.members.find((mem) => mem.id === room.playerIds[i]);
      if (m) m.hand = deck.slice(i * 17, i * 17 + 17);
    }

    // Clear spectator hands
    for (const m of room.members) {
      if (m.role === 'spectator') m.hand = [];
    }

    // Random first bidder
    room.firstBidder = Math.floor(Math.random() * 3);
    room.currentTurn = room.firstBidder;

    // Sort each player's hand before sending
    for (let i = 0; i < 3; i++) {
      const m = room.members.find((mem) => mem.id === room.playerIds[i]);
      if (m) m.hand = sortHand(m.hand);
    }

    // Unicast each player's hand
    for (let i = 0; i < 3; i++) {
      const m = room.members.find((mem) => mem.id === room.playerIds[i]);
      if (m) {
        this.emitToSocket(m.id, 'game_start', { hand: m.hand, firstBidder: room.firstBidder, phase: 'dealing' });
      }
    }

    // Spectators get an empty hand (for consistent client-side state)
    for (const m of room.members) {
      if (m.role === 'spectator') {
        this.emitToSocket(m.id, 'game_start', { hand: [], firstBidder: room.firstBidder, phase: 'dealing' });
      }
    }

    // Delay the bid_open by 2 seconds so players can see their hand first.
    // All 3 players bid simultaneously; a 15s server-side timer enforces the deadline.
    setTimeout(() => {
      this.emitToRoom(room, 'bid_open', { timeoutMs: 8_000, phase: 'bidding' });
      // Unicast each player's individual submission status so the client knows
      // whether to show the bid panel as already submitted (e.g. after reconnect).
      for (let i = 0; i < 3; i++) {
        const pid = room.playerIds[i];
        if (pid) {
          this.emitToSocket(pid, 'bid_status', { submitted: room.bidVotedIndices.includes(i) });
        }
      }
      room.bidTimer = setTimeout(() => {
        room.bidTimer = null;
        this.finalizeBidding(room);
      }, 8_000);
    }, 2_000);
  }

  /**
   * Assign the landlord role, reveal the 3 face-down cards, and start gameplay.
   * Called after the bidding round completes.
   */
  private determineLandlord(room: Room): void {
    const landlordIndex = room.currentBidder;
    room.landlordIndex = landlordIndex;

    const landlordMember = room.members.find(
      (m) => m.id === room.playerIds[landlordIndex],
    );
    if (landlordMember) {
      landlordMember.hand.push(...room.landlordCards);
      landlordMember.hand = sortHand(landlordMember.hand);
    }

    // Landlord leads first
    room.currentTurn = landlordIndex;
    room.passCount = 0;
    room.lastPlay = null;
    room.lastPlayedBy = landlordIndex;
    room.playHistory = [];

    // Emit landlord_decided so clients know who the landlord is and transition phase,
    // then immediately follow with a game_state for the first turn.
    const playerCardCounts = room.playerIds.map((id) => {
      const m = room.members.find((mem) => mem.id === id);
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

  /**
   * Resolve who becomes landlord after the 15-second simultaneous bid window.
   * - If nobody said yes → pick a random player.
   * - If one or more said yes → pick randomly among yes voters.
   * Never re-deals (removed as per spec).
   */
  private finalizeBidding(room: Room): void {
    if (room.bidTimer) { clearTimeout(room.bidTimer); room.bidTimer = null; }
    let chosen: number;
    if (room.bidYesVoters.length === 0) {
      // No volunteers — randomly assign landlord
      chosen = Math.floor(Math.random() * 3);
    } else {
      chosen = room.bidYesVoters[Math.floor(Math.random() * room.bidYesVoters.length)];
    }
    room.currentBidder = chosen;
    this.determineLandlord(room);
  }

  /**
   * All 3 players passed — re-deal with a short delay for UX.
   * Emits `rebid` then starts a new bidding round.
   */
  private reDeal(room: Room): void {
    this.emitToRoom(room, 'rebid', {});
    setTimeout(() => this.startBiddingRound(room), 1_500);
  }

  /**
   * Start a 30-second server-side timer for the given player's turn.
   * When it fires, auto-pass on their behalf exactly as if they called handlePass.
   */
  private startTurnTimer(room: Room, playerIndex: number): void {
    if (room.turnTimer) clearTimeout(room.turnTimer);
    room.turnEndTime = Date.now() + TURN_TIMEOUT_MS;
    room.turnTimer = setTimeout(() => {
      room.turnTimer = null;
      const socketId = room.playerIds[playerIndex];
      if (socketId) this.handlePass(socketId);
    }, TURN_TIMEOUT_MS);
  }

  /** Cancel the current turn timer without triggering a pass. */
  private clearTurnTimer(room: Room): void {
    if (room.turnTimer) { clearTimeout(room.turnTimer); room.turnTimer = null; }
  }

  /**
   * Handle a win condition — emit `game_over` and immediately re-open voting.
   */
  private handleWin(room: Room, winner: 'landlord' | 'peasants'): void {
    // Update per-room win tally before resetting game state
    const playerMembers = room.playerIds
      .map((id) => room.members.find((m) => m.id === id))
      .filter(Boolean) as import('./types').Member[];

    for (let i = 0; i < playerMembers.length; i++) {
      const isWinner =
        winner === 'landlord' ? i === room.landlordIndex : i !== room.landlordIndex;
      if (isWinner) {
        const nick = playerMembers[i].nickname;
        room.winCounts[nick] = (room.winCounts[nick] ?? 0) + 1;
      }
    }

    // Build the authoritative winners list (socket IDs) so frontend never derives it
    const winnerIds = room.playerIds.filter((_, i) =>
      winner === 'landlord' ? i === room.landlordIndex : i !== room.landlordIndex,
    );
    this.emitToRoom(room, 'game_over', {
      winner,
      landlordIndex: room.landlordIndex,
      winCounts: room.winCounts,
      winnerIds,
      phase: 'result',
    });

    // Tear down game state in preparation for the next round
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
    room.playerIds = [];

    // Cancel any pending reconnect timers
    room.reconnectTimers.forEach((t) => clearTimeout(t));
    room.reconnectTimers.clear();

    room.state = 'waiting';
    // After win screen delay, tell all clients to return to lobby then sync member list
    setTimeout(() => {
      this.emitToRoom(room, 'return_to_lobby', { phase: 'lobby' });
      this.emitMembersUpdate(room);
    }, 5_000);
  }

  /**
   * Emergency reset: abort a live game due to a player disconnect/timeout.
   * All members revert to spectator with cleared flags, game fields are
   * cleared, and `game_aborted` is broadcast.
   */
  private resetToWaiting(room: Room): void {
    // Clear timers
    if (room.bidTimer) { clearTimeout(room.bidTimer); room.bidTimer = null; }
    this.clearTurnTimer(room);
    room.reconnectTimers.forEach((t) => clearTimeout(t));
    room.reconnectTimers.clear();

    // Drop disconnected members from the list
    room.members = room.members.filter((m) => !m.disconnectedAt);

    // Reset all remaining members to spectator with cleared flags
    for (const m of room.members) {
      m.role = 'spectator';
      m.hand = [];
      m.wantToPlay = false;
      m.disconnectedAt = undefined;
    }

    // Clear game fields
    room.state = 'waiting';
    room.playerIds = [];
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
  }

  /**
   * Schedule the 5-minute idle timeout that deletes the room when every
   * member has left.
   */
  private startIdleTimeout(room: Room): void {
    if (room.idleTimeout) clearTimeout(room.idleTimeout);
    room.idleTimeout = setTimeout(() => {
      const current = this.roomManager.getRoom(room.code);
      if (current && current.members.length === 0) {
        this.emitToRoom(current, 'room_disbanded', { reason: '房間已關閉（閒置逾時）' });
        this.roomManager.deleteRoom(current.code);
      }
    }, 5 * 60 * 1_000);
  }

  // ── Emoji reactions ──────────────────────────────────────────────────────────

  /**
   * Broadcast an emoji reaction from the sender to the whole room.
   * Rate-limiting (1 per 3 s) is enforced by the gateway before this is called.
   */
  handleReactEmoji(socketId: string, emoji: string): void {
    const room = this.roomManager.getRoomBySocketId(socketId);
    if (!room) return;
    const member = room.members.find((m) => m.id === socketId);
    if (!member) return;

    this.emitToRoom(room, 'emoji_reaction', {
      senderId: socketId,
      senderNickname: member.nickname,
      role: member.role,
      emoji,
    });
  }

  // ── Stats (used by HealthController) ────────────────────────────────────────

  get roomCount(): number {
    return this.roomManager.roomCount;
  }
}
