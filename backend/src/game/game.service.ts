import { Injectable } from '@nestjs/common';
import { Server } from 'socket.io';
import { createDeck, shuffle, sortHand, validatePlay } from './card.utils';
import { RoomManager } from './room.manager';
import { Card, Member, Room } from './types';

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

  // ── Room creation / joining ─────────────────────────────────────────────────

  /**
   * Create a new room. Returns info for the gateway to complete the flow:
   *   1. socket.join(roomCode)
   *   2. socket.emit('room_created', { roomCode, reconnectToken })
   *
   * Transitions waiting → voting if this somehow starts with ≥3 members
   * (edge case guard, normally only 1 member on create).
   */
  handleCreateRoom(
    socketId: string,
    rawNickname: string,
  ): JoinResult | { error: string } {
    const nickname = sanitizeNickname(rawNickname);
    if (!nickname) {
      return { error: '暱稱必須為 2–10 個字元' };
    }

    const { room, reconnectToken } = this.roomManager.createRoom(
      nickname,
      socketId,
    );

    this.checkVoteTransition(room);
    return { roomCode: room.code, reconnectToken, nickname };
  }

  /**
   * Join an existing room. Returns info for the gateway to complete the flow:
   *   1. socket.join(roomCode)
   *   2. socket.emit('room_joined', { roomCode, reconnectToken, members, state, confirmedCount })
   *   3. (already emitted by this method) room broadcast: member_joined
   *      and possibly vote_open (if transition triggers after join)
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

    const result = this.roomManager.joinRoom(upperCode, nickname, socketId);
    if (!result) {
      return { error: '加入房間失敗' };
    }

    const { member, reconnectToken } = result;

    // Broadcast to existing room members (new member hasn't socket.join'd yet,
    // so they won't receive this — correct behaviour)
    this.server
      ?.to(upperCode)
      .emit('member_joined', {
        id: member.id,
        nickname: member.nickname,
        role: member.role,
      });

    // Only check vote transition from 'waiting' state
    this.checkVoteTransition(room);

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
      }));

    return {
      roomCode,
      members,
      state: room.state,
      confirmedCount: room.voteQueue.length,
      confirmedNicknames: room.voteQueue
        .slice(0, 3)
        .map(
          (id) =>
            room.members.find((m) => m.id === id)?.nickname ?? '(已離線)',
        ),
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

    // Still connected (e.g. SPA navigation) — update socket id and return
    if (!member.disconnectedAt) {
      member.id = newSocketId;
      return { roomCode: upperCode, wasDisconnected: false };
    }

    // Cancel the pending 60 s reset timer for this player
    const oldSocketId = member.id;
    const timer = room.reconnectTimers.get(oldSocketId);
    if (timer) {
      clearTimeout(timer);
      room.reconnectTimers.delete(oldSocketId);
    }

    // Restore socket identity
    member.id = newSocketId;
    member.disconnectedAt = undefined;

    return { roomCode: upperCode, wasDisconnected: true };
  }

  /**
   * Emit the current game state back to a reconnected player.
   * Must be called AFTER the gateway has done socket.join(roomCode).
   */
  emitReconnectState(socketId: string, roomCode: string, wasDisconnected = true): void {
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
      }));

    this.server?.to(socketId).emit('room_joined', {
      roomCode,
      members,
      state: room.state,
      confirmedCount: room.voteQueue.length,
      reconnect: true,
    });

    // Re-send hand if in playing state
    if (room.state === 'playing' && member.role === 'player') {
      this.server
        ?.to(socketId)
        .emit('game_start', {
          hand: member.hand,
          firstBidder: room.firstBidder,
          reconnect: true,
        });

      // If it's their turn, notify
      const playerIndex = room.voteQueue.slice(0, 3).indexOf(socketId);
      if (playerIndex !== -1) {
        // During bidding: always re-send bid_turn so the player sees the panel.
        if (room.landlordIndex === -1) {
          this.server?.to(socketId).emit('bid_turn', {
            playerIndex: room.currentTurn,
            currentBid: room.currentBid,
          });
        }
        // During gameplay: emit your_turn if it is their turn.
        if (room.landlordIndex !== -1 && room.currentTurn === playerIndex) {
          this.server?.to(socketId).emit('your_turn', {});
        }
      }
    }

    // Let room know the player is back (skip for soft reconnects like SPA nav)
    if (wasDisconnected) {
      this.server
        ?.to(roomCode)
        .emit('member_joined', {
          id: member.id,
          nickname: member.nickname,
          role: member.role,
        });
    }
  }

  // ── Voting ──────────────────────────────────────────────────────────────────

  /**
   * A member claims a player slot for the upcoming game.
   * Valid only when room.state === 'voting' and the member hasn't voted yet.
   */
  handleVotePlay(socketId: string): void {
    const room = this.roomManager.getRoomBySocketId(socketId);
    if (!room) return;

    if (room.state !== 'voting') {
      this.server?.to(socketId).emit('room_error', { message: '目前無法投票' });
      return;
    }

    if (room.voteQueue.length >= 3) {
      this.server
        ?.to(socketId)
        .emit('room_error', { message: '已有 3 位玩家確認，無法再加入' });
      return;
    }

    if (room.voteQueue.includes(socketId)) {
      this.server?.to(socketId).emit('room_error', { message: '你已投票' });
      return;
    }

    room.voteQueue.push(socketId);

    const confirmedVoters = room.voteQueue
      .slice(0, 3)
      .map(
        (id) =>
          room.members.find((m) => m.id === id)?.nickname ?? '(已離線)',
      );

    this.server?.to(room.code).emit('vote_update', {
      confirmedVoters,
      confirmedCount: room.voteQueue.length,
    });

    if (room.voteQueue.length >= 3) {
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

    const playerIndex = room.voteQueue.slice(0, 3).indexOf(socketId);
    if (playerIndex === -1) return; // spectator

    // Prevent duplicate votes
    if (room.bidVotedIndices.includes(playerIndex)) return;
    room.bidVotedIndices.push(playerIndex);

    if (value === 1) {
      room.bidYesVoters.push(playerIndex);
    }
    room.bidPassCount++;

    this.server
      ?.to(room.code)
      .emit('bid_made', { playerIndex, value });

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

    const playerIndex = room.voteQueue.slice(0, 3).indexOf(socketId);
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

    this.server?.to(room.code).emit('cards_played', {
      playerIndex,
      cards: result.cards,
      handType: result.type,
      rank: result.rank,
      remaining: member.hand.length,
    });

    // Win check
    if (member.hand.length === 0) {
      const winner =
        playerIndex === room.landlordIndex ? 'landlord' : 'peasants';
      this.handleWin(room, winner);
      return;
    }

    // Advance turn and broadcast nextTurn so all clients can track whose turn it is.
    const nextTurn = (room.currentTurn + 1) % 3;
    room.currentTurn = nextTurn;
    this.server?.to(room.code).emit('turn_changed', { nextTurn });
    this.server?.to(room.voteQueue[nextTurn]).emit('your_turn', {});
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

    const playerIndex = room.voteQueue.slice(0, 3).indexOf(socketId);
    if (playerIndex === -1 || playerIndex !== room.currentTurn) return;

    room.passCount++;
    this.server?.to(room.code).emit('player_passed', { playerIndex });

    if (room.passCount >= 2) {
      // Two consecutive passes → the player who last played leads a new round
      const nextTurn = room.lastPlayedBy;
      room.passCount = 0;
      room.lastPlay = null;
      room.currentTurn = nextTurn;
      this.server?.to(room.code).emit('new_round', { nextTurn });
      this.server?.to(room.code).emit('turn_changed', { nextTurn });
      this.server?.to(room.voteQueue[nextTurn]).emit('your_turn', {});
    } else {
      const nextTurn = (room.currentTurn + 1) % 3;
      room.currentTurn = nextTurn;
      this.server?.to(room.code).emit('turn_changed', { nextTurn });
      this.server?.to(room.voteQueue[nextTurn]).emit('your_turn', {});
    }
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

      // Broadcast so other players know
      this.server?.to(room.code).emit('member_left', {
        id: socketId,
        nickname: member.nickname,
      });

      // Schedule automatic room reset if player doesn't reconnect in time
      const timer = setTimeout(() => {
        room.reconnectTimers.delete(socketId);
        this.resetToWaiting(room);
      }, 60_000);
      room.reconnectTimers.set(socketId, timer);
    } else {
      // --- Immediate remove path ---
      this.roomManager.removeSocket(socketId);

      this.server?.to(room.code).emit('member_left', {
        id: socketId,
        nickname: member.nickname,
      });

      // Remove from voteQueue (relevant during 'voting' state)
      if (room.state === 'voting') {
        room.voteQueue = room.voteQueue.filter((id) => id !== socketId);
        if (room.members.length < 3) {
          this.resetVote(room);
        }
      }

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

  /** Transition waiting → voting if ≥3 members are present. */
  private checkVoteTransition(room: Room): void {
    if (room.state === 'waiting' && room.members.length >= 3) {
      this.openVoting(room);
    }
  }

  /**
   * Open the voting phase. Emits `vote_open` and starts the 60-second timeout.
   * Assumes the room is in 'waiting' state or otherwise ready for a new vote.
   */
  private openVoting(room: Room): void {
    // Clear any stale vote timeout
    if (room.voteTimeout) {
      clearTimeout(room.voteTimeout);
      room.voteTimeout = null;
    }

    room.state = 'voting';
    room.voteQueue = [];

    room.voteTimeout = setTimeout(() => {
      if (room.state === 'voting' && room.voteQueue.length < 3) {
        this.resetVote(room);
      }
    }, 60_000);

    const voteOpenMembers = room.members
      .filter((m) => !m.disconnectedAt)
      .map((m) => ({ id: m.id, nickname: m.nickname, role: m.role }));

    this.server
      ?.to(room.code)
      .emit('vote_open', { members: voteOpenMembers, winCounts: room.winCounts });
  }

  /**
   * Cancel an in-progress vote and fall back to 'waiting'.
   * Re-opens a new vote immediately if ≥3 members are still present.
   * Emits `vote_reset`.
   */
  private resetVote(room: Room): void {
    if (room.voteTimeout) {
      clearTimeout(room.voteTimeout);
      room.voteTimeout = null;
    }

    room.state = 'waiting';
    room.voteQueue = [];

    this.server?.to(room.code).emit('vote_reset', {});

    if (room.members.length >= 3) {
      this.openVoting(room);
    }
  }

  /**
   * Assign roles, emit `vote_closed_start`, then start a 3-second countdown
   * before kicking off the first bidding round.
   */
  private startGame(room: Room): void {
    // Freeze vote timeout
    if (room.voteTimeout) {
      clearTimeout(room.voteTimeout);
      room.voteTimeout = null;
    }

    // Assign player / spectator roles
    const playerIdSet = new Set(room.voteQueue.slice(0, 3));
    for (const m of room.members) {
      m.role = playerIdSet.has(m.id) ? 'player' : 'spectator';
    }

    const players = room.voteQueue
      .slice(0, 3)
      .map((id) => room.members.find((m) => m.id === id))
      .filter((m): m is Member => !!m)
      .map((m) => ({ id: m.id, nickname: m.nickname }));

    const spectators = room.members
      .filter((m) => m.role === 'spectator')
      .map((m) => ({ id: m.id, nickname: m.nickname }));

    this.server
      ?.to(room.code)
      .emit('vote_closed_start', { players, spectators });

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

    const playerIds = room.voteQueue.slice(0, 3);
    for (let i = 0; i < 3; i++) {
      const m = room.members.find((mem) => mem.id === playerIds[i]);
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
      const m = room.members.find((mem) => mem.id === playerIds[i]);
      if (m) m.hand = sortHand(m.hand);
    }

    // Unicast each player's hand
    for (let i = 0; i < 3; i++) {
      const m = room.members.find((mem) => mem.id === playerIds[i]);
      if (m) {
        this.server
          ?.to(m.id)
          .emit('game_start', { hand: m.hand, firstBidder: room.firstBidder });
      }
    }

    // Spectators get an empty hand (for consistent client-side state)
    for (const m of room.members) {
      if (m.role === 'spectator') {
        this.server
          ?.to(m.id)
          .emit('game_start', { hand: [], firstBidder: room.firstBidder });
      }
    }

    // Delay the bid_open by 2 seconds so players can see their hand first.
    // All 3 players bid simultaneously; a 15s server-side timer enforces the deadline.
    setTimeout(() => {
      this.server?.to(room.code).emit('bid_open', { timeoutMs: 8_000 });
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

    const playerIds = room.voteQueue.slice(0, 3);
    const landlordMember = room.members.find(
      (m) => m.id === playerIds[landlordIndex],
    );
    if (landlordMember) {
      landlordMember.hand.push(...room.landlordCards);
      landlordMember.hand = sortHand(landlordMember.hand);
    }

    this.server?.to(room.code).emit('landlord_decided', {
      playerIndex: landlordIndex,
      landlordCards: room.landlordCards,
    });

    // Landlord leads first
    room.currentTurn = landlordIndex;
    room.passCount = 0;
    room.lastPlay = null;
    room.lastPlayedBy = landlordIndex;

    this.server?.to(playerIds[landlordIndex]).emit('your_turn', {});
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
    this.server?.to(room.code).emit('rebid', {});
    setTimeout(() => this.startBiddingRound(room), 1_500);
  }

  /**
   * Advance to the next player's gameplay turn.
   * Called after a successful card play.
   */
  private advanceGameTurn(room: Room): void {
    const nextTurn = (room.currentTurn + 1) % 3;
    room.currentTurn = nextTurn;
    this.server?.to(room.voteQueue[nextTurn]).emit('your_turn', {});
  }

  /**
   * Handle a win condition — emit `game_over` and immediately re-open voting.
   */
  private handleWin(room: Room, winner: 'landlord' | 'peasants'): void {
    // Update per-room win tally before resetting game state
    const playerMembers = room.voteQueue
      .slice(0, 3)
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

    this.server?.to(room.code).emit('game_over', {
      winner,
      landlordIndex: room.landlordIndex,
      winCounts: room.winCounts,
    });

    // Tear down game state in preparation for the next round
    for (const m of room.members) {
      m.role = 'spectator';
      m.hand = [];
    }

    room.deck = [];
    room.landlordCards = [];
    room.landlordIndex = -1;
    room.passCount = 0;
    room.lastPlay = null;
    room.lastPlayedBy = -1;
    room.bidPassCount = 0;
    room.bidVotedIndices = [];
    if (room.bidTimer) { clearTimeout(room.bidTimer); room.bidTimer = null; }
    room.voteQueue = [];

    // Cancel any pending reconnect timers
    room.reconnectTimers.forEach((t) => clearTimeout(t));
    room.reconnectTimers.clear();

    // Delay re-opening voting so clients can show the win screen for 5 seconds
    room.state = 'waiting'; // openVoting requires 'waiting' as pre-condition
    setTimeout(() => this.openVoting(room), 5_000);
  }

  /**
   * Emergency reset: abort a live game due to a player disconnect/timeout.
   * All members revert to spectator, game fields are cleared, `vote_reset`
   * is broadcast, and a new vote opens if ≥3 members remain.
   */
  private resetToWaiting(room: Room): void {
    // Clear timers
    if (room.voteTimeout) {
      clearTimeout(room.voteTimeout);
      room.voteTimeout = null;
    }
    if (room.bidTimer) { clearTimeout(room.bidTimer); room.bidTimer = null; }
    room.reconnectTimers.forEach((t) => clearTimeout(t));
    room.reconnectTimers.clear();

    // Drop disconnected members from the list
    room.members = room.members.filter((m) => !m.disconnectedAt);

    // Reset all remaining members to spectator with empty hands
    for (const m of room.members) {
      m.role = 'spectator';
      m.hand = [];
      m.disconnectedAt = undefined;
    }

    // Clear game fields
    room.state = 'waiting';
    room.voteQueue = [];
    room.deck = [];
    room.landlordCards = [];
    room.landlordIndex = -1;
    room.currentTurn = 0;
    room.currentBid = 0;
    room.currentBidder = -1;
    room.passCount = 0;
    room.lastPlay = null;
    room.lastPlayedBy = -1;
    room.bidPassCount = 0;
    room.bidYesVoters = [];
    room.bidVotedIndices = [];

    this.server?.to(room.code).emit('vote_reset', {});

    if (room.members.length >= 3) {
      this.openVoting(room);
    }
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
        this.server
          ?.to(current.code)
          .emit('room_disbanded', { reason: '房間已關閉（閒置逾時）' });
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

    this.server?.to(room.code).emit('emoji_reaction', {
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
